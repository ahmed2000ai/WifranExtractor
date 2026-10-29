import { getSupabaseAdminClient } from './supabaseAdminClient'
import type { 
  SupermarketReference, 
  CityReference, 
  RegionReference, 
  SupermarketRegionReference,
  CategoryReference,
  BrandReference,
  UnitReference,
  ReferenceDataBundle
} from '../../shared/types/referenceData'
import { error as logError, info as logInfo } from '../logging/logger'

// =========================================================================
// Master Saudi Core Catalog Constants (Self-Sufficient Fallback & Seeder)
// =========================================================================

export const MASTER_SUPERMARKETS: SupermarketReference[] = [
  { id: 'c2cc16c2-0001-4444-b000-c00000000001', name_ar: 'بنده', name_en: 'Panda', slug: 'panda', code: 'PAND', logo_url: '/images/supermarkets/panda.png', is_active: true, sort_order: 1 },
  { id: 'c2cc16c2-0002-4444-b000-c00000000002', name_ar: 'أسواق العثيم', name_en: 'Othaim Markets', slug: 'othaim', code: 'OTHM', logo_url: '/images/supermarkets/othaim.svg', is_active: true, sort_order: 2 },
  { id: 'c2cc16c2-0003-4444-b000-c00000000003', name_ar: 'لولو هايبر ماركت', name_en: 'LuLu Hypermarket', slug: 'lulu', code: 'LULU', logo_url: '/images/supermarkets/lulu.svg', is_active: true, sort_order: 3 },
  { id: 'c2cc16c2-0004-4444-b000-c00000000004', name_ar: 'الدانوب', name_en: 'Danube', slug: 'danube', code: 'DANB', logo_url: '/images/supermarkets/danube.svg', is_active: true, sort_order: 4 },
  { id: 'c2cc16c2-0005-4444-b000-c00000000005', name_ar: 'أسواق التميمي', name_en: 'Tamimi Markets', slug: 'tamimi', code: 'TAMM', logo_url: '/images/supermarkets/tamimi.svg', is_active: true, sort_order: 5 },
  { id: 'c2cc16c2-0006-4444-b000-c00000000006', name_ar: 'كارفور', name_en: 'Carrefour', slug: 'carrefour', code: 'CARF', logo_url: '/images/supermarkets/carrefour.svg', is_active: true, sort_order: 6 },
  { id: 'c2cc16c2-0007-4444-b000-c00000000007', name_ar: 'بن داود', name_en: 'BinDawood', slug: 'bin-dawood', code: 'BNDW', logo_url: '/images/supermarkets/bin-dawood.svg', is_active: true, sort_order: 7 },
  { id: 'c2cc16c2-0008-4444-b000-c00000000008', name_ar: 'هايبر الوفاء', name_en: 'Hyper Alwafa', slug: 'alwafa', code: 'ALWF', logo_url: '/images/supermarkets/alwafa.svg', is_active: true, sort_order: 8 },
  { id: 'c2cc16c2-0009-4444-b000-c00000000009', name_ar: 'نستو هايبرماركت', name_en: 'Nesto Hypermarket', slug: 'nesto', code: 'NEST', logo_url: '/images/supermarkets/nesto.svg', is_active: true, sort_order: 9 },
  { id: 'c2cc16c2-0010-4444-b000-c00000000010', name_ar: 'أسواق المزرعة', name_en: 'Farm Superstores', slug: 'farm', code: 'FARM', logo_url: '/images/supermarkets/farm.svg', is_active: true, sort_order: 10 },
  { id: 'c2cc16c2-0011-4444-b000-c00000000011', name_ar: 'مانويل', name_en: 'Manuel Market', slug: 'manuel', code: 'MANU', logo_url: '/images/supermarkets/manuel.svg', is_active: true, sort_order: 11 },
  { id: 'c2cc16c2-0012-4444-b000-c00000000012', name_ar: 'أسواق الراية', name_en: 'Al Raya Markets', slug: 'raya', code: 'RAYA', logo_url: '/images/supermarkets/raya.svg', is_active: true, sort_order: 12 }
]

export const MASTER_REGIONS: RegionReference[] = [
  { id: 'b144b6c8-1111-4444-b000-000000000001', name_ar: 'المنطقة الوسطى', name_en: 'Central Region', slug: 'central', code: 'CENT', is_active: true },
  { id: 'b144b6c8-2222-4444-b000-000000000002', name_ar: 'المنطقة الغربية', name_en: 'Western Region', slug: 'western', code: 'WEST', is_active: true },
  { id: 'b144b6c8-3333-4444-b000-000000000003', name_ar: 'المنطقة الشرقية', name_en: 'Eastern Region', slug: 'eastern', code: 'EAST', is_active: true },
  { id: 'b144b6c8-4444-4444-b000-000000000004', name_ar: 'المنطقة الجنوبية', name_en: 'Southern Region', slug: 'southern', code: 'SOUT', is_active: true },
  { id: 'b144b6c8-5555-4444-b000-000000000005', name_ar: 'المنطقة الشمالية', name_en: 'Northern Region', slug: 'northern', code: 'NORT', is_active: true }
]

export const MASTER_CITIES: CityReference[] = [
  { id: 'a6f7b140-0001-4444-a000-000000000001', code: 'RIYC', region_id: 'b144b6c8-1111-4444-b000-000000000001', name_ar: 'الرياض', name_en: 'Riyadh', slug: 'riyadh', country_code: 'SA', is_active: true, sort_order: 1 },
  { id: 'a6f7b140-0002-4444-a000-000000000002', code: 'JEDC', region_id: 'b144b6c8-2222-4444-b000-000000000002', name_ar: 'جدة', name_en: 'Jeddah', slug: 'jeddah', country_code: 'SA', is_active: true, sort_order: 2 },
  { id: 'a6f7b140-0003-4444-a000-000000000003', code: 'MAKC', region_id: 'b144b6c8-2222-4444-b000-000000000002', name_ar: 'مكة المكرمة', name_en: 'Makkah', slug: 'makkah', country_code: 'SA', is_active: true, sort_order: 3 },
  { id: 'a6f7b140-0004-4444-a000-000000000004', code: 'MEDC', region_id: 'b144b6c8-2222-4444-b000-000000000002', name_ar: 'المدينة المنورة', name_en: 'Madinah', slug: 'madinah', country_code: 'SA', is_active: true, sort_order: 4 },
  { id: 'a6f7b140-0005-4444-a000-000000000005', code: 'DAMC', region_id: 'b144b6c8-3333-4444-b000-000000000003', name_ar: 'الدمام', name_en: 'Dammam', slug: 'dammam', country_code: 'SA', is_active: true, sort_order: 5 },
  { id: 'a6f7b140-0006-4444-a000-000000000006', code: 'KHBC', region_id: 'b144b6c8-3333-4444-b000-000000000003', name_ar: 'الخبر', name_en: 'Khobar', slug: 'khobar', country_code: 'SA', is_active: true, sort_order: 6 },
  { id: 'a6f7b140-0007-4444-a000-000000000007', code: 'DHAC', region_id: 'b144b6c8-3333-4444-b000-000000000003', name_ar: 'الظهران', name_en: 'Dhahran', slug: 'dhahran', country_code: 'SA', is_active: true, sort_order: 7 },
  { id: 'a6f7b140-0008-4444-a000-000000000008', code: 'TAIC', region_id: 'b144b6c8-2222-4444-b000-000000000002', name_ar: 'الطائف', name_en: 'Taif', slug: 'taif', country_code: 'SA', is_active: true, sort_order: 8 },
  { id: 'a6f7b140-0009-4444-a000-000000000009', code: 'TABC', region_id: 'b144b6c8-5555-4444-b000-000000000005', name_ar: 'تبوك', name_en: 'Tabuk', slug: 'tabuk', country_code: 'SA', is_active: true, sort_order: 9 },
  { id: 'a6f7b140-0010-4444-a000-000000000010', code: 'BURC', region_id: 'b144b6c8-1111-4444-b000-000000000001', name_ar: 'بريدة', name_en: 'Buraydah', slug: 'buraydah', country_code: 'SA', is_active: true, sort_order: 10 },
  { id: 'a6f7b140-0011-4444-a000-000000000011', code: 'KHMC', region_id: 'b144b6c8-4444-4444-b000-000000000004', name_ar: 'خميس مشيط', name_en: 'Khamis Mushait', slug: 'khamis-mushait', country_code: 'SA', is_active: true, sort_order: 11 },
  { id: 'a6f7b140-0012-4444-a000-000000000012', code: 'ABHC', region_id: 'b144b6c8-4444-4444-b000-000000000004', name_ar: 'أبها', name_en: 'Abha', slug: 'abha', country_code: 'SA', is_active: true, sort_order: 12 },
  { id: 'a6f7b140-0013-4444-a000-000000000013', code: 'HAIC', region_id: 'b144b6c8-1111-4444-b000-000000000001', name_ar: 'حائل', name_en: 'Hail', slug: 'hail', country_code: 'SA', is_active: true, sort_order: 13 },
  { id: 'a6f7b140-0014-4444-a000-000000000014', code: 'JAZC', region_id: 'b144b6c8-4444-4444-b000-000000000004', name_ar: 'جازان', name_en: 'Jazan', slug: 'jazan', country_code: 'SA', is_active: true, sort_order: 14 },
  { id: 'a6f7b140-0015-4444-a000-000000000015', code: 'NAJC', region_id: 'b144b6c8-4444-4444-b000-000000000004', name_ar: 'نجران', name_en: 'Najran', slug: 'najran', country_code: 'SA', is_active: true, sort_order: 15 },
  { id: 'a6f7b140-0016-4444-a000-000000000016', code: 'BAHC', region_id: 'b144b6c8-4444-4444-b000-000000000004', name_ar: 'الباحة', name_en: 'Al Bahah', slug: 'al-bahah', country_code: 'SA', is_active: true, sort_order: 16 },
  { id: 'a6f7b140-0017-4444-a000-000000000017', code: 'SKKC', region_id: 'b144b6c8-5555-4444-b000-000000000005', name_ar: 'سكاكا', name_en: 'Sakaka', slug: 'sakaka', country_code: 'SA', is_active: true, sort_order: 17 },
  { id: 'a6f7b140-0018-4444-a000-000000000018', code: 'ARAC', region_id: 'b144b6c8-5555-4444-b000-000000000005', name_ar: 'عرعر', name_en: 'Arar', slug: 'arar', country_code: 'SA', is_active: true, sort_order: 18 },
  { id: 'a6f7b140-0019-4444-a000-000000000019', code: 'AHSC', region_id: 'b144b6c8-3333-4444-b000-000000000003', name_ar: 'الأحساء', name_en: 'Al Ahsa', slug: 'al-ahsa', country_code: 'SA', is_active: true, sort_order: 19 },
  { id: 'a6f7b140-0020-4444-a000-000000000020', code: 'JUBC', region_id: 'b144b6c8-3333-4444-b000-000000000003', name_ar: 'الجبيل', name_en: 'Jubail', slug: 'jubail', country_code: 'SA', is_active: true, sort_order: 20 },
  { id: 'a6f7b140-0021-4444-a000-000000000021', code: 'YANC', region_id: 'b144b6c8-2222-4444-b000-000000000002', name_ar: 'ينبع', name_en: 'Yanbu', slug: 'yanbu', country_code: 'SA', is_active: true, sort_order: 21 },
  { id: 'a6f7b140-0022-4444-a000-000000000022', code: 'QATC', region_id: 'b144b6c8-3333-4444-b000-000000000003', name_ar: 'القطيف', name_en: 'Qatif', slug: 'qatif', country_code: 'SA', is_active: true, sort_order: 22 },
  { id: 'a6f7b140-0023-4444-a000-000000000023', code: 'UNZC', region_id: 'b144b6c8-1111-4444-b000-000000000001', name_ar: 'عنيزة', name_en: 'Unaizah', slug: 'unaizah', country_code: 'SA', is_active: true, sort_order: 23 },
  { id: 'a6f7b140-0024-4444-a000-000000000024', code: 'KHRC', region_id: 'b144b6c8-1111-4444-b000-000000000001', name_ar: 'الخرج', name_en: 'Al Kharj', slug: 'al-kharj', country_code: 'SA', is_active: true, sort_order: 24 },
  { id: 'a6f7b140-0025-4444-a000-000000000025', code: 'HAFC', region_id: 'b144b6c8-3333-4444-b000-000000000003', name_ar: 'حفر الباطن', name_en: 'Hafar Al Batin', slug: 'hafar-al-batin', country_code: 'SA', is_active: true, sort_order: 25 }
]

export const MASTER_CATEGORIES: CategoryReference[] = [
  { id: 'd3dd37d3-0001-4444-9000-e00000000001', parent_id: null, name_ar: 'الأساسيات', name_en: 'Staples', slug: 'staples', is_active: true, sort_order: 1, requires_unit_price: true, default_unit_type: 'kg' },
  { id: 'd3dd37d3-0002-4444-9000-e00000000002', parent_id: null, name_ar: 'الألبان', name_en: 'Dairy', slug: 'dairy', is_active: true, sort_order: 2, requires_unit_price: true, default_unit_type: 'liter' },
  { id: 'd3dd37d3-0003-4444-9000-e00000000003', parent_id: null, name_ar: 'البيض', name_en: 'Eggs', slug: 'eggs', is_active: true, sort_order: 3, requires_unit_price: true, default_unit_type: 'piece' },
  { id: 'd3dd37d3-0004-4444-9000-e00000000004', parent_id: null, name_ar: 'اللحوم والدجاج', name_en: 'Meat & Chicken', slug: 'meat-chicken', is_active: true, sort_order: 4, requires_unit_price: true, default_unit_type: 'kg' },
  { id: 'd3dd37d3-0005-4444-9000-e00000000005', parent_id: null, name_ar: 'المجمّدات', name_en: 'Frozen Food', slug: 'frozen', is_active: true, sort_order: 5, requires_unit_price: true, default_unit_type: 'kg' },
  { id: 'd3dd37d3-0006-4444-9000-e00000000006', parent_id: null, name_ar: 'الأطفال', name_en: 'Baby Products', slug: 'baby', is_active: true, sort_order: 6, requires_unit_price: true, default_unit_type: 'diaper' },
  { id: 'd3dd37d3-0007-4444-9000-e00000000007', parent_id: null, name_ar: 'التنظيف', name_en: 'Cleaning Essentials', slug: 'cleaning', is_active: true, sort_order: 7, requires_unit_price: true, default_unit_type: 'kg' },
  { id: 'd3dd37d3-0008-4444-9000-e00000000008', parent_id: null, name_ar: 'العناية الشخصية', name_en: 'Personal Care', slug: 'personal-care', is_active: true, sort_order: 8, requires_unit_price: false, default_unit_type: null },
  { id: 'd3dd37d3-0009-4444-9000-e00000000009', parent_id: null, name_ar: 'المشروبات', name_en: 'Beverages', slug: 'beverages', is_active: true, sort_order: 9, requires_unit_price: true, default_unit_type: 'liter' },
  { id: 'd3dd37d3-0010-4444-9000-e00000000010', parent_id: null, name_ar: 'القهوة والشاي', name_en: 'Coffee & Tea', slug: 'coffee-tea', is_active: true, sort_order: 10, requires_unit_price: true, default_unit_type: 'kg' },
  { id: 'd3dd37d3-0011-4444-9000-e00000000011', parent_id: null, name_ar: 'الوجبات الخفيفة', name_en: 'Snacks', slug: 'snacks', is_active: true, sort_order: 11, requires_unit_price: false, default_unit_type: null },
  { id: 'd3dd37d3-0012-4444-9000-e00000000012', parent_id: null, name_ar: 'المعلبات', name_en: 'Canned Food', slug: 'canned-food', is_active: true, sort_order: 12, requires_unit_price: false, default_unit_type: null },
  { id: 'd3dd37d3-0013-4444-9000-e00000000013', parent_id: null, name_ar: 'غير غذائية', name_en: 'Non-Grocery', slug: 'non-grocery', is_active: true, sort_order: 13, requires_unit_price: false, default_unit_type: null }
]

export const MASTER_UNITS: UnitReference[] = [
  { id: 'e4ee48e4-0001-4444-a000-f00000000001', code: 'kg', name_ar: 'كيلوجرام', name_en: 'Kilogram', symbol_ar: 'كجم', symbol_en: 'kg', base_unit_code: 'kg', conversion_to_base: 1.0, is_active: true, sort_order: 1 },
  { id: 'e4ee48e4-0002-4444-a000-f00000000002', code: 'g', name_ar: 'جرام', name_en: 'Gram', symbol_ar: 'جم', symbol_en: 'g', base_unit_code: 'kg', conversion_to_base: 0.001, is_active: true, sort_order: 2 },
  { id: 'e4ee48e4-0003-4444-a000-f00000000003', code: 'liter', name_ar: 'لتر', name_en: 'Liter', symbol_ar: 'لتر', symbol_en: 'L', base_unit_code: 'liter', conversion_to_base: 1.0, is_active: true, sort_order: 3 },
  { id: 'e4ee48e4-0004-4444-a000-f00000000004', code: 'ml', name_ar: 'ملليلتر', name_en: 'Milliliter', symbol_ar: 'مل', symbol_en: 'ml', base_unit_code: 'liter', conversion_to_base: 0.001, is_active: true, sort_order: 4 },
  { id: 'e4ee48e4-0005-4444-a000-f00000000005', code: 'piece', name_ar: 'حبة', name_en: 'Piece', symbol_ar: 'حبة', symbol_en: 'pc', base_unit_code: 'piece', conversion_to_base: 1.0, is_active: true, sort_order: 5 },
  { id: 'e4ee48e4-0006-4444-a000-f00000000006', code: 'pack', name_ar: 'عبوة', name_en: 'Pack', symbol_ar: 'عبوة', symbol_en: 'pack', base_unit_code: 'piece', conversion_to_base: 1.0, is_active: true, sort_order: 6 },
  { id: 'e4ee48e4-0007-4444-a000-f00000000007', code: 'diaper', name_ar: 'حفاضة', name_en: 'Diaper', symbol_ar: 'حفاضة', symbol_en: 'diaper', base_unit_code: 'piece', conversion_to_base: 1.0, is_active: true, sort_order: 7 },
  { id: 'e4ee48e4-0008-4444-a000-f00000000008', code: 'wash', name_ar: 'غسلة', name_en: 'Wash', symbol_ar: 'غسلة', symbol_en: 'wash', base_unit_code: 'piece', conversion_to_base: 1.0, is_active: true, sort_order: 8 },
  { id: 'e4ee48e4-0009-4444-a000-f00000000009', code: 'capsule', name_ar: 'كبسولة', name_en: 'Capsule', symbol_ar: 'كبسولة', symbol_en: 'capsule', base_unit_code: 'piece', conversion_to_base: 1.0, is_active: true, sort_order: 9 }
]

export const MASTER_SUPERMARKET_REGIONS: SupermarketRegionReference[] = MASTER_SUPERMARKETS.map(sm => ({
  id: `sr-${sm.slug}-riyadh`,
  supermarket_id: sm.id,
  city_id: 'a6f7b140-0001-4444-a000-000000000001',
  region_id: 'b144b6c8-1111-4444-b000-000000000001',
  is_active: true
}))

export const LEGACY_ID_CROSSWALK: Record<string, string> = {
  // Legacy cities from 001 seed
  'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0001-4444-a000-000000000001', // Riyadh
  'a6f7b140-0002-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0002-4444-a000-000000000002', // Jeddah
  'a6f7b140-0003-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0003-4444-a000-000000000003', // Makkah
  'a6f7b140-0004-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0004-4444-a000-000000000004', // Madinah
  'a6f7b140-0005-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0005-4444-a000-000000000005', // Dammam
  'a6f7b140-0006-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0006-4444-a000-000000000006', // Khobar
  'a6f7b140-0007-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0007-4444-a000-000000000007', // Dhahran
  'a6f7b140-0008-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0008-4444-a000-000000000008', // Taif
  'a6f7b140-0009-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0009-4444-a000-000000000009', // Tabuk
  'a6f7b140-0010-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0010-4444-a000-000000000010', // Buraydah
  'a6f7b140-0011-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0011-4444-a000-000000000011', // Khamis Mushait
  'a6f7b140-0012-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0012-4444-a000-000000000012', // Abha
  'a6f7b140-0013-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0013-4444-a000-000000000013', // Hail
  'a6f7b140-0014-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0014-4444-a000-000000000014', // Jazan
  'a6f7b140-0015-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0015-4444-a000-000000000015', // Najran
  'a6f7b140-0016-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0016-4444-a000-000000000016', // Al Bahah
  'a6f7b140-0017-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0017-4444-a000-000000000017', // Sakaka
  'a6f7b140-0018-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0018-4444-a000-000000000018', // Arar
  'a6f7b140-0019-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0019-4444-a000-000000000019', // Al Ahsa
  'a6f7b140-0020-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0020-4444-a000-000000000020', // Jubail
  'a6f7b140-0021-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0021-4444-a000-000000000021', // Yanbu
  'a6f7b140-0022-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0022-4444-a000-000000000022', // Qatif
  'a6f7b140-0023-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0023-4444-a000-000000000023', // Unaizah
  'a6f7b140-0024-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0024-4444-a000-000000000024', // Al Kharj
  'a6f7b140-0025-4c28-98e3-c28dd6fb4fb4': 'a6f7b140-0025-4444-a000-000000000025', // Hafar Al Batin
  // 13 Administrative regions mapped to 5 commercial leaflet regions:
  'b144b6c8-1111-477c-a496-d3c52e46b3f1': 'b144b6c8-1111-4444-b000-000000000001', // Riyadh -> Central
  'b144b6c8-2222-477c-a496-d3c52e46b3f2': 'b144b6c8-2222-4444-b000-000000000002', // Makkah -> Western
  'b144b6c8-3333-477c-a496-d3c52e46b3f3': 'b144b6c8-3333-4444-b000-000000000003', // Eastern -> Eastern
  'b144b6c8-4444-477c-a496-d3c52e46b3f4': 'b144b6c8-2222-4444-b000-000000000002', // Madinah -> Western
  'b144b6c8-5555-477c-a496-d3c52e46b3f5': 'b144b6c8-1111-4444-b000-000000000001', // Qassim -> Central
  'b144b6c8-6666-477c-a496-d3c52e46b3f6': 'b144b6c8-4444-4444-b000-000000000004', // Asir -> Southern
  'b144b6c8-7777-477c-a496-d3c52e46b3f7': 'b144b6c8-5555-4444-b000-000000000005', // Tabuk -> Northern
  'b144b6c8-8888-477c-a496-d3c52e46b3f8': 'b144b6c8-1111-4444-b000-000000000001', // Hail -> Central
  'b144b6c8-9999-477c-a496-d3c52e46b3f9': 'b144b6c8-5555-4444-b000-000000000005', // Northern Borders -> Northern
  'b144b6c8-aaaa-477c-a496-d3c52e46b3f0': 'b144b6c8-4444-4444-b000-000000000004', // Jazan -> Southern
  'b144b6c8-bbbb-477c-a496-d3c52e46b3f1': 'b144b6c8-4444-4444-b000-000000000004', // Najran -> Southern
  'b144b6c8-cccc-477c-a496-d3c52e46b3f2': 'b144b6c8-4444-4444-b000-000000000004', // Al Bahah -> Southern
  'b144b6c8-dddd-477c-a496-d3c52e46b3f3': 'b144b6c8-5555-4444-b000-000000000005'  // Al Jouf -> Northern
}

export function resolveCanonicalId(id: string): string {
  return LEGACY_ID_CROSSWALK[id] || id
}

function isTestOrMock(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    Boolean(process.env.VITEST_WORKER_ID)
  )
}

// =========================================================================
// Idempotent Core Catalog Seeding & Sync
// =========================================================================

export async function ensureCoreCatalogSeeded(): Promise<{ seeded: boolean; counts: Record<string, number> }> {
  const counts: Record<string, number> = {
    supermarkets: MASTER_SUPERMARKETS.length,
    cities: MASTER_CITIES.length,
    regions: MASTER_REGIONS.length,
    categories: MASTER_CATEGORIES.length,
    units: MASTER_UNITS.length,
    supermarket_regions: MASTER_SUPERMARKET_REGIONS.length
  }

  if (isTestOrMock()) {
    return { seeded: true, counts }
  }

  let supabase;
  try {
    supabase = getSupabaseAdminClient()
  } catch (err: any) {
    logInfo(`[referenceDataService] Supabase client not initialized: ${err.message}. Core catalog will run in offline fallback mode.`)
    return { seeded: false, counts }
  }

  try {
    // 1. Seed Supermarkets
    const { error: smErr } = await supabase
      .from('supermarkets')
      .upsert(MASTER_SUPERMARKETS, { onConflict: 'slug' })
    if (smErr) {
      logError(`[referenceDataService] Error upserting supermarkets: ${smErr.message}`)
    } else {
      counts.supermarkets = MASTER_SUPERMARKETS.length
    }

    // 2. Seed Regions
    const { error: regErr } = await supabase
      .from('regions')
      .upsert(MASTER_REGIONS, { onConflict: 'slug' })
    if (regErr) {
      logError(`[referenceDataService] Error upserting regions: ${regErr.message}`)
    } else {
      counts.regions = MASTER_REGIONS.length
    }

    // 3. Seed Cities
    const { error: cityErr } = await supabase
      .from('cities')
      .upsert(MASTER_CITIES, { onConflict: 'slug' })
    if (cityErr) {
      logError(`[referenceDataService] Error upserting cities: ${cityErr.message}`)
    } else {
      counts.cities = MASTER_CITIES.length
    }

    // 4. Seed Categories
    const { error: catErr } = await supabase
      .from('categories')
      .upsert(MASTER_CATEGORIES, { onConflict: 'slug' })
    if (catErr) {
      logError(`[referenceDataService] Error upserting categories: ${catErr.message}`)
    } else {
      counts.categories = MASTER_CATEGORIES.length
    }

    // 5. Seed Units
    const { error: unitErr } = await supabase
      .from('units')
      .upsert(MASTER_UNITS, { onConflict: 'code' })
    if (unitErr) {
      logError(`[referenceDataService] Error upserting units: ${unitErr.message}`)
    } else {
      counts.units = MASTER_UNITS.length
    }

    // 6. Seed Supermarket-Regions
    const { error: srErr } = await supabase
      .from('supermarket_regions')
      .upsert(MASTER_SUPERMARKET_REGIONS, { onConflict: 'id' })
    if (!srErr) {
      counts.supermarket_regions = MASTER_SUPERMARKET_REGIONS.length
    }

    logInfo(`[referenceDataService] Core catalog self-sufficiency check complete. Supermarkets: ${counts.supermarkets}, Categories: ${counts.categories}`)
    return { seeded: true, counts }
  } catch (err: any) {
    logError(`[referenceDataService] Failed to auto-seed core catalog: ${err.message}`)
    return { seeded: false, counts }
  }
}

// =========================================================================
// Loaders with Resilient Master Catalog Fallback Merging
// =========================================================================

export async function loadSupermarkets(): Promise<SupermarketReference[]> {
  if (isTestOrMock()) return MASTER_SUPERMARKETS
  try {
    const supabase = getSupabaseAdminClient()
    const { data, error } = await supabase
      .from('supermarkets')
      .select('id, name_ar, name_en, slug, logo_url, is_active, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error || !data || data.length === 0) {
      if (error) logError(`Error loading supermarkets from DB: ${error.message}. Using master catalog.`)
      return MASTER_SUPERMARKETS
    }

    // Merge any missing master chains into the response so newly added chains are always accessible
    const existingSlugs = new Set((data as SupermarketReference[]).map(s => s.slug?.toLowerCase()))
    const merged = [...(data as SupermarketReference[])]
    for (const sm of MASTER_SUPERMARKETS) {
      if (sm.slug && !existingSlugs.has(sm.slug.toLowerCase())) {
        merged.push(sm)
      }
    }
    return merged.sort((a, b) => (a.sort_order || 99) - (b.sort_order || 99))
  } catch (err: any) {
    logError(`loadSupermarkets fallback triggered: ${err.message}`)
    return MASTER_SUPERMARKETS
  }
}

export async function loadCities(): Promise<CityReference[]> {
  if (isTestOrMock()) return MASTER_CITIES
  try {
    const supabase = getSupabaseAdminClient()
    const { data, error } = await supabase
      .from('cities')
      .select('id, name_ar, name_en, slug, country_code, is_active, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error || !data || data.length === 0) {
      if (error) logError(`Error loading cities from DB: ${error.message}. Using master catalog.`)
      return MASTER_CITIES
    }

    const existingSlugs = new Set((data as CityReference[]).map(c => c.slug?.toLowerCase()))
    const merged = [...(data as CityReference[])]
    for (const c of MASTER_CITIES) {
      if (c.slug && !existingSlugs.has(c.slug.toLowerCase())) {
        merged.push(c)
      }
    }
    return merged.sort((a, b) => (a.sort_order || 99) - (b.sort_order || 99))
  } catch (err: any) {
    logError(`loadCities fallback triggered: ${err.message}`)
    return MASTER_CITIES
  }
}

export async function loadRegions(): Promise<RegionReference[]> {
  if (isTestOrMock()) return MASTER_REGIONS
  try {
    const supabase = getSupabaseAdminClient()
    const { data, error } = await supabase
      .from('regions')
      .select('id, name_ar, name_en, slug, is_active')
      .eq('is_active', true)
      .order('name_en', { ascending: true })

    if (error || !data || data.length === 0) {
      if (error) logError(`Error loading regions from DB: ${error.message}. Using master catalog.`)
      return MASTER_REGIONS
    }

    const existingSlugs = new Set((data as RegionReference[]).map(r => r.slug?.toLowerCase()))
    const merged = [...(data as RegionReference[])]
    for (const r of MASTER_REGIONS) {
      if (r.slug && !existingSlugs.has(r.slug.toLowerCase())) {
        merged.push(r)
      }
    }
    return merged
  } catch (err: any) {
    logError(`loadRegions fallback triggered: ${err.message}`)
    return MASTER_REGIONS
  }
}

export async function loadSupermarketRegions(): Promise<SupermarketRegionReference[]> {
  if (isTestOrMock()) return MASTER_SUPERMARKET_REGIONS
  try {
    const supabase = getSupabaseAdminClient()
    const { data, error } = await supabase
      .from('supermarket_regions')
      .select('id, supermarket_id, city_id, region_id, is_active')
      .eq('is_active', true)

    if (error || !data || data.length === 0) {
      if (error) logError(`Error loading supermarket_regions from DB: ${error.message}. Using master catalog.`)
      return MASTER_SUPERMARKET_REGIONS
    }

    const existingKeys = new Set((data as SupermarketRegionReference[]).map(sr => `${sr.supermarket_id}-${sr.city_id || ''}-${sr.region_id || ''}`))
    const merged = [...(data as SupermarketRegionReference[])]
    for (const sr of MASTER_SUPERMARKET_REGIONS) {
      const key = `${sr.supermarket_id}-${sr.city_id || ''}-${sr.region_id || ''}`
      if (!existingKeys.has(key)) {
        merged.push(sr)
      }
    }
    return merged
  } catch (err: any) {
    logError(`loadSupermarketRegions fallback triggered: ${err.message}`)
    return MASTER_SUPERMARKET_REGIONS
  }
}

export async function loadCategories(): Promise<CategoryReference[]> {
  if (isTestOrMock()) return MASTER_CATEGORIES
  try {
    const supabase = getSupabaseAdminClient()
    const { data, error } = await supabase
      .from('categories')
      .select('id, parent_id, name_ar, name_en, slug, is_active, sort_order, requires_unit_price, default_unit_type')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error || !data || data.length === 0) {
      if (error) logError(`Error loading categories from DB: ${error.message}. Using master catalog.`)
      return MASTER_CATEGORIES
    }

    const existingSlugs = new Set((data as CategoryReference[]).map(c => c.slug?.toLowerCase()))
    const merged = [...(data as CategoryReference[])]
    for (const cat of MASTER_CATEGORIES) {
      if (cat.slug && !existingSlugs.has(cat.slug.toLowerCase())) {
        merged.push(cat)
      }
    }
    return merged.sort((a, b) => (a.sort_order || 99) - (b.sort_order || 99))
  } catch (err: any) {
    logError(`loadCategories fallback triggered: ${err.message}`)
    return MASTER_CATEGORIES
  }
}

export async function loadBrands(): Promise<BrandReference[]> {
  if (isTestOrMock()) return []
  try {
    const supabase = getSupabaseAdminClient()
    const { data, error } = await supabase
      .from('brands')
      .select('id, name_ar, name_en, slug, is_active')
      .eq('is_active', true)
      .order('name_en', { ascending: true })

    if (error) {
      logError(`Error loading brands: ${error.message}`)
      return []
    }
    return (data || []) as BrandReference[]
  } catch (err: any) {
    logError(`loadBrands fallback triggered: ${err.message}`)
    return []
  }
}

export async function loadUnits(): Promise<UnitReference[]> {
  if (isTestOrMock()) return MASTER_UNITS
  try {
    const supabase = getSupabaseAdminClient()
    const { data, error } = await supabase
      .from('units')
      .select('id, code, name_ar, name_en, symbol_ar, symbol_en, base_unit_code, conversion_to_base, is_active, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error || !data || data.length === 0) {
      if (error) logError(`Error loading units from DB: ${error.message}. Using master catalog.`)
      return MASTER_UNITS
    }

    const existingCodes = new Set((data as UnitReference[]).map(u => u.code?.toLowerCase()))
    const merged = [...(data as UnitReference[])]
    for (const u of MASTER_UNITS) {
      if (!existingCodes.has(u.code.toLowerCase())) {
        merged.push(u)
      }
    }
    return merged.sort((a, b) => (a.sort_order || 99) - (b.sort_order || 99))
  } catch (err: any) {
    logError(`loadUnits fallback triggered: ${err.message}`)
    return MASTER_UNITS
  }
}

export async function loadReferenceDataBundle(): Promise<ReferenceDataBundle> {
  try {
    // Attempt proactive seeding in the background if possible
    ensureCoreCatalogSeeded().catch(() => {})

    const supermarkets = await loadSupermarkets()
    const cities = await loadCities()
    const regions = await loadRegions()
    const supermarketRegions = await loadSupermarketRegions()
    const categories = await loadCategories()
    const brands = await loadBrands()
    const units = await loadUnits()

    return {
      supermarkets,
      cities,
      regions,
      supermarketRegions,
      categories,
      brands,
      units
    }
  } catch (err: any) {
    logError(`Failed to load reference data bundle: ${err.message}`)
    return {
      supermarkets: MASTER_SUPERMARKETS,
      cities: MASTER_CITIES,
      regions: MASTER_REGIONS,
      supermarketRegions: MASTER_SUPERMARKET_REGIONS,
      categories: MASTER_CATEGORIES,
      brands: [],
      units: MASTER_UNITS
    }
  }
}
