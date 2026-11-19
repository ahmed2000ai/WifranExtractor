import 'dotenv/config'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BrandGroupingService } from '../src/main/db/brandGroupingService'
import { MatchingEvidenceOverlayService } from '../src/main/db/matchingEvidenceOverlayService'
import { evaluateIdentitySufficiency } from '../src/main/db/productIdentityPolicy'
import { GeminiMatchingService } from '../src/main/ocr/geminiMatchingService'
import { getModelPricing } from '../src/main/ocr/geminiPricingTable'
import {
  createGuardedPgClient,
  getGuardedSupabaseClient,
  DEVELOPMENT_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  resolveDatabaseConfig
} from '../src/main/db/databaseEnvironmentResolver'
import type { UnifiedBatchOffer } from '../src/shared/types/batchExtraction'

// Load .env.local explicitly so DEVELOPMENT_TEST credentials match project config
import * as dotenv from 'dotenv'
dotenv.config({ path: join(process.cwd(), '.env.local') })
dotenv.config({ path: join(process.cwd(), '.env') })

const SCRIPT_TIMEOUT_MS = 60000

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
  // --- SEARA (Targets + Carton/Single/Size/Cut Distractors) ---
  { catalogKey: 'seara_breast_1800', role: 'target', name_en: 'Seara Frozen Tender Chicken Breast 1.8Kg', name_ar: 'صدور دجاج طرية مجمدة سيارا 1.8 كجم', brand_name: 'Seara', variant_or_flavor: 'Tender Breast', each_size_value: 1800, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'seara_chicken_carton_10x900', role: 'target', name_en: 'Seara Frozen Chicken Carton 10x900g', name_ar: 'دجاج مجمد سيارا كرتون 10×900 جم', brand_name: 'Seara', variant_or_flavor: null, each_size_value: 900, each_size_unit: 'g', inner_pack_count: 10, sale_unit_type: 'carton' },
  { catalogKey: 'seara_dist_1000', role: 'distractor_size', name_en: 'Seara Frozen Whole Chicken 1000g', name_ar: 'دجاج سيارا مجمد 1000 جم', brand_name: 'Seara', variant_or_flavor: null, each_size_value: 1000, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'seara_dist_10x1000', role: 'distractor_size', name_en: 'Seara Frozen Chicken Carton 10x1000g', name_ar: 'دجاج سيارا مجمد كرتون 10×1000 جم', brand_name: 'Seara', variant_or_flavor: null, each_size_value: 1000, each_size_unit: 'g', inner_pack_count: 10, sale_unit_type: 'carton' },
  { catalogKey: 'seara_dist_breast_1000', role: 'distractor_size', name_en: 'Seara Tender Chicken Breast 1000g', name_ar: 'صدور دجاج سيارا 1000 جم', brand_name: 'Seara', variant_or_flavor: 'Tender Breast', each_size_value: 1000, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },

  // --- SADIA (Targets + Size/Pack/Variant Distractors) ---
  { catalogKey: 'sadia_chicken_carton_10x1000', role: 'target', name_en: 'Sadia Whole Chicken Carton 10x1000g', name_ar: 'دجاج ساديا كامل كرتون 10×1000 جم', brand_name: 'Sadia', variant_or_flavor: null, each_size_value: 1000, each_size_unit: 'g', inner_pack_count: 10, sale_unit_type: 'carton' },
  { catalogKey: 'sadia_chicken_single_1000', role: 'target', name_en: 'Sadia Whole Chicken 1000g', name_ar: 'دجاج ساديا كامل 1000 جم', brand_name: 'Sadia', variant_or_flavor: null, each_size_value: 1000, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'sadia_dist_1100', role: 'distractor_size', name_en: 'Sadia Whole Chicken 1100g', name_ar: 'دجاج ساديا كامل 1100 جم', brand_name: 'Sadia', variant_or_flavor: null, each_size_value: 1100, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'sadia_dist_nuggets_tempura_270', role: 'distractor_variant', name_en: 'Sadia Chicken Nuggets Tempura 270g', name_ar: 'ناجتس دجاج ساديا تمبورا 270 جم', brand_name: 'Sadia', variant_or_flavor: 'Tempura', each_size_value: 270, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'sadia_dist_nuggets_spicy_270', role: 'distractor_variant', name_en: 'Sadia Chicken Nuggets Spicy 270g', name_ar: 'ناجتس دجاج ساديا حار 270 جم', brand_name: 'Sadia', variant_or_flavor: 'Spicy', each_size_value: 270, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },

  // --- DARI (Target + Distractor) ---
  { catalogKey: 'dari_chicken_10x900', role: 'target', name_en: 'Dari Frozen Chicken Carton 10x900g', name_ar: 'دجاج داري مجمد كرتون 10×900 جم', brand_name: 'Dari', variant_or_flavor: null, each_size_value: 900, each_size_unit: 'g', inner_pack_count: 10, sale_unit_type: 'carton' },
  { catalogKey: 'dari_dist_single_900', role: 'distractor_pack', name_en: 'Dari Frozen Chicken 900g', name_ar: 'دجاج داري مجمد 900 جم', brand_name: 'Dari', variant_or_flavor: null, each_size_value: 900, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },

  // --- TANMIAH (Target 1100g + Distractor 1200g/900g; note 1000g intentionally absent!) ---
  { catalogKey: 'tanmiah_fresh_1100', role: 'target', name_en: 'Tanmiah Fresh Whole Chicken 1100g', name_ar: 'دجاج طازج التنمية 1100 جم', brand_name: 'Tanmiah', variant_or_flavor: null, each_size_value: 1100, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'tanmiah_dist_1200', role: 'distractor_size', name_en: 'Tanmiah Fresh Whole Chicken 1200g', name_ar: 'دجاج طازج التنمية 1200 جم', brand_name: 'Tanmiah', variant_or_flavor: null, each_size_value: 1200, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'tanmiah_dist_900', role: 'distractor_size', name_en: 'Tanmiah Fresh Whole Chicken 900g', name_ar: 'دجاج طازج التنمية 900 جم', brand_name: 'Tanmiah', variant_or_flavor: null, each_size_value: 900, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },

  // --- ENTAJ (Targets + Distractor) ---
  { catalogKey: 'entaj_breast_fillet_900', role: 'target', name_en: 'Entaj Fresh Chicken Breast Fillet 900g', name_ar: 'فيليه صدور دجاج طازج إنتاج 900 جم', brand_name: 'Entaj', variant_or_flavor: 'Breast Fillet', each_size_value: 900, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'entaj_drumstick_450', role: 'target', name_en: 'Entaj Fresh Chicken Portion Drumstick 450g', name_ar: 'أفخاذ دجاج طازجة إنتاج 450 جم', brand_name: 'Entaj', variant_or_flavor: 'Drumstick', each_size_value: 450, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'entaj_breast_fillet_450', role: 'target', name_en: 'Entaj Fresh Chicken Breast Fillet 450g', name_ar: 'فيليه صدور دجاج طازجة إنتاج 450 جم', brand_name: 'Entaj', variant_or_flavor: 'Breast Fillet', each_size_value: 450, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'entaj_dist_wings_450', role: 'distractor_cut', name_en: 'Entaj Fresh Chicken Wings 450g', name_ar: 'أجنحة دجاج طازجة إنتاج 450 جم', brand_name: 'Entaj', variant_or_flavor: 'Wings', each_size_value: 450, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },

  // --- DAIRY & EGGS (Targets + Distractors) ---
  { catalogKey: 'golden_crown_cream_6x155', role: 'target', name_en: 'Golden Crown Cream 6x155g', name_ar: 'قشطة التاج الذهبي 6×155 جم', brand_name: 'Golden Crown', variant_or_flavor: null, each_size_value: 155, each_size_unit: 'g', inner_pack_count: 6, sale_unit_type: 'pack' },
  { catalogKey: 'golden_crown_dist_1x155', role: 'distractor_pack', name_en: 'Golden Crown Cream 155g', name_ar: 'قشطة التاج الذهبي 155 جم', brand_name: 'Golden Crown', variant_or_flavor: null, each_size_value: 155, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'president_mozzarella_900', role: 'target', name_en: 'President Shredded Mozzarella Cheese 900g', name_ar: 'جبنة موزاريلا بريزيدن مبشورة 900 جم', brand_name: 'President', variant_or_flavor: 'Mozzarella', each_size_value: 900, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'president_dist_450', role: 'distractor_size', name_en: 'President Shredded Mozzarella Cheese 450g', name_ar: 'جبنة موزاريلا بريزيدن 450 جم', brand_name: 'President', variant_or_flavor: 'Mozzarella', each_size_value: 450, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'president_dist_cheddar_900', role: 'distractor_variant', name_en: 'President Cheddar Cheese 900g', name_ar: 'جبنة شيدر بريزيدن 900 جم', brand_name: 'President', variant_or_flavor: 'Cheddar', each_size_value: 900, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'philadelphia_cream_cheese_500', role: 'target', name_en: 'Philadelphia Original Cream Cheese 500g', name_ar: 'جبنة كريم فيلادلفيا أصلية 500 جم', brand_name: 'Philadelphia', variant_or_flavor: 'Original', each_size_value: 500, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'philadelphia_dist_light_200', role: 'distractor_size', name_en: 'Philadelphia Light Cream Cheese 200g', name_ar: 'جبنة كريم فيلادلفيا لايت 200 جم', brand_name: 'Philadelphia', variant_or_flavor: 'Light', each_size_value: 200, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'almarai_evap_milk_6x170', role: 'target', name_en: 'Almarai Evaporated Milk 6x170g', name_ar: 'حليب مبخر المراعي 6×170 جم', brand_name: 'Almarai', variant_or_flavor: null, each_size_value: 170, each_size_unit: 'g', inner_pack_count: 6, sale_unit_type: 'pack' },
  { catalogKey: 'almarai_dist_170', role: 'distractor_pack', name_en: 'Almarai Evaporated Milk 170g', name_ar: 'حليب مبخر المراعي 170 جم', brand_name: 'Almarai', variant_or_flavor: null, each_size_value: 170, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'almarai_dist_fresh_milk_1l', role: 'distractor_noise', name_en: 'Almarai Fresh Milk Full Fat 1L', name_ar: 'حليب طازج المراعي كامل الدسم 1 لتر', brand_name: 'Almarai', variant_or_flavor: 'Full Fat', each_size_value: 1000, each_size_unit: 'ml', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'almarai_dist_unsalted_butter_100', role: 'distractor_noise', name_en: 'Almarai Unsalted Butter 100g', name_ar: 'زبدة المراعي غير مملحة 100 جم', brand_name: 'Almarai', variant_or_flavor: 'Unsalted', each_size_value: 100, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'nadec_uht_milk_4x1l', role: 'target', name_en: 'Nadec UHT Full Fat Milk 4x1L', name_ar: 'حليب نادك طويل الأجل كامل الدسم 4×1 لتر', brand_name: 'Nadec', variant_or_flavor: 'Full Fat', each_size_value: 1000, each_size_unit: 'ml', inner_pack_count: 4, sale_unit_type: 'pack' },
  { catalogKey: 'nadec_dist_single_1l', role: 'distractor_pack', name_en: 'Nadec UHT Full Fat Milk 1L', name_ar: 'حليب نادك طويل الأجل كامل الدسم 1 لتر', brand_name: 'Nadec', variant_or_flavor: 'Full Fat', each_size_value: 1000, each_size_unit: 'ml', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'nadec_dist_lowfat_4x1l', role: 'distractor_variant', name_en: 'Nadec UHT Low Fat Milk 4x1L', name_ar: 'حليب نادك قليل الدسم 4×1 لتر', brand_name: 'Nadec', variant_or_flavor: 'Low Fat', each_size_value: 1000, each_size_unit: 'ml', inner_pack_count: 4, sale_unit_type: 'pack' },
  { catalogKey: 'al_failaq_eggs_30', role: 'target', name_en: 'Al Failaq Fresh White Eggs 30pcs', name_ar: 'بيض أبيض طازج الفيلق 30 حبة', brand_name: 'Al Failaq', variant_or_flavor: 'White', each_size_value: 30, each_size_unit: 'pcs', inner_pack_count: 1, sale_unit_type: 'pack' },
  { catalogKey: 'pride_labneh_1kg', role: 'target', name_en: 'Pride Creamy Labneh 1Kg', name_ar: 'لبنة كريمية برايد 1 كجم', brand_name: 'Pride', variant_or_flavor: 'Creamy', each_size_value: 1000, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'pride_dist_500g', role: 'distractor_size', name_en: 'Pride Creamy Labneh 500g', name_ar: 'لبنة كريمية برايد 500 جم', brand_name: 'Pride', variant_or_flavor: 'Creamy', each_size_value: 500, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },

  // --- STAPLES & SNACKS & CLEANING (Targets + Near-Match Distractors + Absent-SKU Brand Catalogs) ---
  { catalogKey: 'alsafeer_rice_5kg', role: 'target', name_en: 'AlSafeer Sella Basmati Rice 5Kg', name_ar: 'أرز بسمتي سيلا السفير 5 كجم', brand_name: 'AlSafeer', variant_or_flavor: 'Sella Basmati', each_size_value: 5000, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'bag' },
  { catalogKey: 'alsafeer_dist_10kg', role: 'distractor_size', name_en: 'AlSafeer Sella Basmati Rice 10Kg', name_ar: 'أرز بسمتي سيلا السفير 10 كجم', brand_name: 'AlSafeer', variant_or_flavor: 'Sella Basmati', each_size_value: 10000, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'bag' },
  { catalogKey: 'nestle_cornflakes_500g', role: 'target', name_en: 'Nestle Country Corn Flakes 500g', name_ar: 'رقائق الذرة نستله كنتري 500 جم', brand_name: 'Nestle', variant_or_flavor: null, each_size_value: 500, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'box' },
  { catalogKey: 'nestle_dist_375g', role: 'distractor_size', name_en: 'Nestle Country Corn Flakes 375g', name_ar: 'رقائق الذرة نستله كنتري 375 جم', brand_name: 'Nestle', variant_or_flavor: null, each_size_value: 375, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'box' },
  { catalogKey: 'al_batal_chips_12x23', role: 'target', name_en: 'Al Batal Potato Chips Salted Carton 12x23g', name_ar: 'شيبس بطاطس البطل مملح 12×23 جم', brand_name: 'Al Batal', variant_or_flavor: null, each_size_value: 23, each_size_unit: 'g', inner_pack_count: 12, sale_unit_type: 'carton' },
  { catalogKey: 'al_batal_dist_single_23', role: 'distractor_pack', name_en: 'Al Batal Potato Chips Salted 23g', name_ar: 'شيبس بطاطس البطل مملح 23 جم', brand_name: 'Al Batal', variant_or_flavor: null, each_size_value: 23, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'tiffany_butter_cookies_12x40', role: 'target', name_en: 'Tiffany Butter Cookies Carton 12x40g', name_ar: 'بسكويت الزبدة تيفاني 12×40 جم', brand_name: 'Tiffany', variant_or_flavor: 'Butter', each_size_value: 40, each_size_unit: 'g', inner_pack_count: 12, sale_unit_type: 'carton' },
  { catalogKey: 'ever_white_10kg', role: 'target', name_en: 'Ever White Washing Powder 10Kg', name_ar: 'مسحوق غسيل إيفر وايت 10 كجم', brand_name: 'Ever White', variant_or_flavor: null, each_size_value: 10000, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'bag' },
  { catalogKey: 'persil_powder_2_25kg', role: 'target', name_en: 'Persil Power Washing Powder 2.25Kg', name_ar: 'مسحوق غسيل برسيل 2.25 كجم', brand_name: 'Persil', variant_or_flavor: null, each_size_value: 2250, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'bag' },
  { catalogKey: 'persil_dist_4_5kg', role: 'distractor_size', name_en: 'Persil Power Washing Powder 4.5Kg', name_ar: 'مسحوق غسيل برسيل 4.5 كجم', brand_name: 'Persil', variant_or_flavor: null, each_size_value: 4500, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'bag' },
  { catalogKey: 'wafir_detergent_2_5kg', role: 'target', name_en: 'Wafir Blue Detergent Powder 2.5Kg', name_ar: 'مسحوق غسيل وفير أزرق 2.5 كجم', brand_name: 'Wafir', variant_or_flavor: 'Blue', each_size_value: 2500, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'bag' },

  // --- NOISE FOR ABSENT-SKU SAME-BRAND TESTS (Galaxy, Cadbury, Rabea, Golden Chicken) ---
  { catalogKey: 'galaxy_dist_smooth_150', role: 'distractor_noise', name_en: 'Galaxy Smooth Milk Chocolate 150g', name_ar: 'شوكولاتة جالكسي حليب ناعم 150 جم', brand_name: 'Galaxy', variant_or_flavor: 'Smooth Milk', each_size_value: 150, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'cadbury_dist_dairymilk_180', role: 'distractor_noise', name_en: 'Cadbury Dairy Milk Bar 180g', name_ar: 'شوكولاتة كادبوري ديري ميلك 180 جم', brand_name: 'Cadbury', variant_or_flavor: 'Dairy Milk', each_size_value: 180, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'rabea_dist_loose_400g', role: 'distractor_noise', name_en: 'Rabea Loose Leaf Black Tea 400g', name_ar: 'شاي ربيع فرط 400 جم', brand_name: 'Rabea', variant_or_flavor: 'Loose Leaf', each_size_value: 400, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'box' },
  { catalogKey: 'golden_chicken_dist_1100', role: 'distractor_noise', name_en: 'Golden Chicken Fresh Whole Chicken 1100g', name_ar: 'دجاج كامل طازج الفروج الذهبي 1100 جم', brand_name: 'Golden Chicken', variant_or_flavor: null, each_size_value: 1100, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' }
]

function toUnifiedOffer(item: any, overlayAnnotation: any | null): UnifiedBatchOffer {
  const rawData = JSON.parse(readFileSync(join(process.cwd(), item.sourceFilePath), 'utf8'))
  const isLegacyOthaim = item.workspace === 'Othaim_week24' && !rawData.product
  const rawAssort = isLegacyOthaim ? null : rawData?.contract_v2?.assortment?.status
  const rawMulti = item.rawIsMultiBrandOrVariant === true

  let assortmentStatusForOffer: string | null = rawAssort || null
  if (!assortmentStatusForOffer && rawMulti) {
    assortmentStatusForOffer = 'assortment_indicated'
  }
  if (!assortmentStatusForOffer) {
    // Explicitly preserve unrecorded/unknown instead of fabricating 'single_sku'
    assortmentStatusForOffer = 'unknown'
  }

  return {
    batchId: 'preflight_003',
    leafletId: item.workspace,
    sourceFileName: `${item.canonicalSourceId}.json`,
    sourcePdfPath: '',
    sourcePage: 1,
    sourceOfferId: item.canonicalSourceId,
    canonicalSourceId: item.canonicalSourceId,
    batchOfferKey: `preflight_003::${item.canonicalSourceId}`,
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
    promoPrice: isLegacyOthaim ? rawData.offer_price_sar ?? null : rawData.prices?.offer_price ?? null,
    originalPrice: isLegacyOthaim ? rawData.original_price_sar ?? null : rawData.prices?.original_price ?? null,
    discountPercent: null,
    promoNotes: null,
    sizeOrWeight: item.sizeOrWeight,
    each_size_value: item.eachSizeValue,
    each_size_unit: item.eachSizeUnit,
    inner_pack_count: isLegacyOthaim
      ? 1
      : typeof rawData.content?.pack_quantity === 'number'
      ? rawData.content.pack_quantity
      : 1,
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
    confidence:
      item.preservedConfidence === 'high' || item.preservedConfidence === 'low'
        ? item.preservedConfidence
        : 'medium',
    canonical: rawData
  }
}

async function runPreflight(): Promise<void> {
  const timeoutHandle = setTimeout(() => {
    console.error(`[FATAL] 003 Preflight exceeded ${SCRIPT_TIMEOUT_MS}ms timeout.`)
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

  try {
    // 0. Baseline Dev DB check
    const beforeProdRes = await pgClient.query(`SELECT count(*)::int AS cnt FROM public.products`)
    const beforeOfferRes = await pgClient.query(`SELECT count(*)::int AS cnt FROM public.offers`)
    const baselineCounts = {
      products: beforeProdRes.rows[0]?.cnt ?? 0,
      offers: beforeOfferRes.rows[0]?.cnt ?? 0
    }
    console.log('[Preflight003] Initial DEVELOPMENT_TEST counts:', baselineCounts)

    // 1. Seed realistic Development catalog
    const catalogIdByKey = new Map<string, string>()
    for (const spec of REALISTIC_DEV_CATALOG) {
      const insertRes = await pgClient.query(
        `INSERT INTO public.products (
          name_en, name_ar, brand_name, variant_or_flavor,
          each_size_value, each_size_unit, inner_pack_count,
          sale_unit_type, verification_status, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'verified', true)
        RETURNING id`,
        [
          spec.name_en,
          spec.name_ar,
          spec.brand_name,
          spec.variant_or_flavor,
          spec.each_size_value,
          spec.each_size_unit,
          spec.inner_pack_count,
          spec.sale_unit_type
        ]
      )
      const genId = String(insertRes.rows[0].id)
      seededIds.push(genId)
      catalogIdByKey.set(spec.catalogKey, genId)
    }
    console.log(`[Preflight003] Seeded ${seededIds.length} realistic catalog products into DEVELOPMENT_TEST (${DEVELOPMENT_PROJECT_REF}).`)

    const supabase = getGuardedSupabaseClient('DEVELOPMENT_TEST')
    const dataset = JSON.parse(
      readFileSync(join(process.cwd(), 'test-fixtures', 'matching-benchmarks', 'real_world_100_dataset_v1.json'), 'utf8')
    )
    const overlayFile = join(
      process.cwd(),
      'test-fixtures',
      'matching-benchmarks',
      'real_world_100_evidence_overlay.json'
    )
    const overlayRaw = JSON.parse(readFileSync(overlayFile, 'utf8'))
    const gemini = new GeminiMatchingService()

    const evaluateTrack = async (trackName: 'automatic' | 'evidence_assisted', useOverlay: boolean) => {
      const overlayService = useOverlay ? new MatchingEvidenceOverlayService(overlayFile) : new MatchingEvidenceOverlayService(join(process.cwd(), 'Extracts', 'nonexistent_empty_overlay_003.json'))
      const grouping = new BrandGroupingService(overlayService)
      const batchOffers = dataset.items.map((item: any) =>
        toUnifiedOffer(item, useOverlay ? overlayRaw.annotations[item.canonicalSourceId] || null : null)
      )
      const brandGroups = grouping.groupOffersByBrand(batchOffers)

      const requestsPlan: any[] = []
      const retrievalDiagnostics: any[] = []
      const offlineResolutions: any[] = []
      let existingTargetsTotal = 0
      let existingTargetsRetrieved = 0
      const missedTargetDetails: any[] = []

      for (const group of brandGroups) {
        const sufficientIdentities = group.uniqueIdentities.filter(
          (ui) => evaluateIdentitySufficiency(ui.normalizedAttrs, ui.memberOffers[0], ui.normalizedAttrs.evidenceAnnotation).isSufficient
        )
        const insufficientIdentities = group.uniqueIdentities.filter(
          (ui) => !evaluateIdentitySufficiency(ui.normalizedAttrs, ui.memberOffers[0], ui.normalizedAttrs.evidenceAnnotation).isSufficient
        )

        for (const ui of insufficientIdentities) {
          offlineResolutions.push({
            canonicalSourceId: ui.memberOffers[0].canonicalSourceId,
            brandKey: group.brandKey,
            route: 'offline_insufficiency_abstention',
            decision: 'unresolved',
            costUsd: 0
          })
        }

        if (sufficientIdentities.length === 0) continue

        const retrieval = await grouping.retrieveBrandCandidates(supabase, group, 50)
        group.candidates = retrieval.candidates

        // Track recall for any expected 'existing' item in this brand
        for (const ui of sufficientIdentities) {
          for (const mo of ui.memberOffers) {
            const dsItem = dataset.items.find((x: any) => x.canonicalSourceId === mo.canonicalSourceId)!
            const expectedDecision = useOverlay ? dsItem.expectedDecisionAssisted : dsItem.expectedDecisionAutomatic
            if (expectedDecision === 'existing' && dsItem.targetCatalogKey) {
              existingTargetsTotal++
              const expectedId = catalogIdByKey.get(dsItem.targetCatalogKey)!
              const foundInCands = retrieval.candidates.some((c) => String(c.id) === String(expectedId))
              if (foundInCands) {
                existingTargetsRetrieved++
              } else {
                missedTargetDetails.push({
                  canonicalSourceId: dsItem.canonicalSourceId,
                  brandKey: group.brandKey,
                  targetCatalogKey: dsItem.targetCatalogKey,
                  expectedId,
                  retrievedIds: retrieval.candidates.map((c) => `${c.id}:${c.nameEn}`)
                })
              }
            }
          }
        }

        if (retrieval.candidates.length === 0) {
          const tempGroupStub = { ...group, candidates: [], totalBrandProducts: retrieval.totalBrandProducts } as any
          for (const ui of sufficientIdentities) {
            const absence = await grouping.verifyAbsenceInBrandCatalog(supabase, tempGroupStub, ui)
            offlineResolutions.push({
              canonicalSourceId: ui.memberOffers[0].canonicalSourceId,
              brandKey: group.brandKey,
              route: 'offline_zero_candidate_absence_proof',
              decision: absence.isExhaustivelyAbsent ? 'temporary' : 'unresolved',
              isExhaustivelyAbsent: absence.isExhaustivelyAbsent,
              costUsd: 0
            })
          }
          retrievalDiagnostics.push({
            brandKey: group.brandKey,
            sufficientCount: sufficientIdentities.length,
            candidatesRetrieved: 0,
            completeness: retrieval.retrievalCompleteness,
            track: 'offline_zero_candidate'
          })
          continue
        }

        const pricing = getModelPricing('gemini-3.8-flash', 'flex')
        // Chunk calculation using real production determineChunkSize logic (<=25 candidates -> 40; >25 -> 20)
        const chunkSize = retrieval.candidates.length > 25 ? 20 : 40
        for (let i = 0; i < sufficientIdentities.length; i += chunkSize) {
          const chunk = sufficientIdentities.slice(i, i + chunkSize)
          const payload = gemini.buildPromptPayload({
            brandKey: group.brandKey,
            brandName: group.brandNameEn || group.brandKey,
            candidates: retrieval.candidates,
            items: chunk
          })
          const estInputTokens = Math.ceil((payload.systemPrompt.length + payload.userContent.length) / 3.6)
          const estOutputTokens = chunk.length * 16 + 12
          const estThinkingTokens = 1100 // Realistic MEDIUM thinking per request based on 002B baseline (~815 avg/req, conservative 1100)
          const estCost =
            (estInputTokens * pricing.inputPerMillion +
              estOutputTokens * pricing.outputPerMillion +
              estThinkingTokens * pricing.thinkingPerMillion) /
            1_000_000

          requestsPlan.push({
            requestNumber: requestsPlan.length + 1,
            brandKey: group.brandKey,
            brandName: group.brandNameEn || group.brandKey,
            candidateCount: retrieval.candidates.length,
            chunkSizeUsed: chunkSize,
            itemCount: chunk.length,
            itemSourceIds: chunk.map((c) => c.memberOffers.map((m) => m.canonicalSourceId).join(',')),
            estInputTokens,
            estOutputTokens,
            estThinkingTokens,
            estCostUsd: Number(estCost.toFixed(8))
          })
        }

        retrievalDiagnostics.push({
          brandKey: group.brandKey,
          sufficientCount: sufficientIdentities.length,
          candidatesRetrieved: retrieval.candidates.length,
          candidateNames: retrieval.candidates.map((c) => `${c.id}:${c.nameEn}`),
          completeness: retrieval.retrievalCompleteness,
          track: 'gemini_flex_medium'
        })
      }

      const totalEstInput = requestsPlan.reduce((s, r) => s + r.estInputTokens, 0)
      const totalEstOutput = requestsPlan.reduce((s, r) => s + r.estOutputTokens, 0)
      const totalEstThinking = requestsPlan.reduce((s, r) => s + r.estThinkingTokens, 0)
      const totalEstCost = Number(requestsPlan.reduce((s, r) => s + r.estCostUsd, 0).toFixed(6))
      const pricing = getModelPricing('gemini-3.8-flash', 'flex')

      return {
        trackName,
        totalInputOffers: batchOffers.length,
        groupedBrandCount: brandGroups.length,
        groupedUniqueIdentities: brandGroups.reduce((s, g) => s + g.uniqueIdentities.length, 0),
        offlineAbstentionsCount: offlineResolutions.filter((x) => x.route === 'offline_insufficiency_abstention').length,
        offlineZeroCandidateCount: offlineResolutions.filter((x) => x.route === 'offline_zero_candidate_absence_proof').length,
        geminiRequestCount: requestsPlan.length,
        geminiIdentitiesCount: requestsPlan.reduce((s, r) => s + r.itemCount, 0),
        candidateRecall: {
          existingTargetsTotal,
          existingTargetsRetrieved,
          recallRate: existingTargetsTotal > 0 ? Number((existingTargetsRetrieved / existingTargetsTotal).toFixed(4)) : 1,
          missedTargetDetails
        },
        tokenAndCostEstimate: {
          model: 'gemini-3.8-flash',
          thinkingLevel: 'MEDIUM',
          executionTier: 'flex',
          location: 'global',
          pricingPerMillion: pricing,
          estInputTokens: totalEstInput,
          estOutputTokens: totalEstOutput,
          estThinkingTokens: totalEstThinking,
          estTotalCostUsd: totalEstCost,
          recommendedCostCapUsd: Number((totalEstCost * 1.75 + 0.01).toFixed(4)),
          recommendedMaxRequestsCap: requestsPlan.length + 2,
          estLatencyMinutesRange: [
            Number(((requestsPlan.length * 45) / 60).toFixed(1)),
            Number(((requestsPlan.length * 115) / 60).toFixed(1))
          ]
        },
        requestsPlan,
        retrievalDiagnostics
      }
    }

    const automaticTrack = await evaluateTrack('automatic', false)
    const assistedTrack = await evaluateTrack('evidence_assisted', true)

    const report = {
      generatedAt: new Date().toISOString(),
      milestone: 'WIFRAN-EXTRACTOR-CATALOG-MATCH-003',
      paidGeminiCallsExecuted: 0,
      environment: {
        databaseContext: envCheck.context,
        projectRef: DEVELOPMENT_PROJECT_REF,
        productionProjectRef: PRODUCTION_PROJECT_REF,
        productionTouched: false
      },
      baselineCountsBeforeSeeding: baselineCounts,
      seededCatalogCount: seededIds.length,
      datasetCounts: dataset.counts,
      automaticTrack,
      evidenceAssistedTrack: assistedTrack
    }

    const outPath = join(process.cwd(), 'Extracts', 'preflight_003_benchmark_plan.json')
    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
    console.log(`[Preflight003] Wrote full offline retrieval & budget plan -> ${outPath}`)
    console.log(
      '[Preflight003] Automatic recall:',
      JSON.stringify(automaticTrack.candidateRecall),
      'Requests:',
      automaticTrack.geminiRequestCount,
      'EstCost:',
      automaticTrack.tokenAndCostEstimate.estTotalCostUsd
    )
    console.log(
      '[Preflight003] Assisted recall:',
      JSON.stringify(assistedTrack.candidateRecall),
      'Requests:',
      assistedTrack.geminiRequestCount,
      'EstCost:',
      assistedTrack.tokenAndCostEstimate.estTotalCostUsd
    )
  } finally {
    // Guaranteed cleanup + post-cleanup zero-row verification
    try {
      if (seededIds.length > 0) {
        await pgClient.query(`DELETE FROM public.products WHERE id = ANY($1::bigint[])`, [seededIds])
      }
      const afterProdRes = await pgClient.query(`SELECT count(*)::int AS cnt FROM public.products`)
      const afterOfferRes = await pgClient.query(`SELECT count(*)::int AS cnt FROM public.offers`)
      const cleanupReport = {
        verifiedAt: new Date().toISOString(),
        projectRef: DEVELOPMENT_PROJECT_REF,
        context: 'DEVELOPMENT_TEST',
        seededRowsRemoved: seededIds.length,
        remainingProducts: afterProdRes.rows[0]?.cnt ?? -1,
        remainingOffers: afterOfferRes.rows[0]?.cnt ?? -1,
        clean: (afterProdRes.rows[0]?.cnt ?? -1) === 0 && (afterOfferRes.rows[0]?.cnt ?? -1) === 0
      }
      const cleanupPath = join(process.cwd(), 'Extracts', 'cleanup_verification_003.json')
      writeFileSync(cleanupPath, JSON.stringify(cleanupReport, null, 2), 'utf8')
      console.log('[Preflight003] Cleanup verification:', JSON.stringify(cleanupReport))
    } finally {
      await pgClient.end()
      clearTimeout(timeoutHandle)
    }
  }
}

runPreflight()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Preflight003] Error:', err)
    process.exit(1)
  })
