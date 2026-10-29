-- =========================================================================
-- Wifran Core Catalog Seed Data
-- Script: 001_seed_core_catalog.sql
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. Ensure identifier and hierarchy columns exist
-- -------------------------------------------------------------------------
ALTER TABLE public.supermarkets ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.regions ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.cities ADD COLUMN IF NOT EXISTS code text, ADD COLUMN IF NOT EXISTS region_id text;

-- -------------------------------------------------------------------------
-- 1. Seed Regions (5 Commercial Leaflet Regions - INT-F04)
-- -------------------------------------------------------------------------
insert into public.regions (id, name_ar, name_en, slug, code, is_active)
values
  ('b144b6c8-1111-4444-b000-000000000001', 'المنطقة الوسطى', 'Central Region', 'central', 'CENT', true),
  ('b144b6c8-2222-4444-b000-000000000002', 'المنطقة الغربية', 'Western Region', 'western', 'WEST', true),
  ('b144b6c8-3333-4444-b000-000000000003', 'المنطقة الشرقية', 'Eastern Region', 'eastern', 'EAST', true),
  ('b144b6c8-4444-4444-b000-000000000004', 'المنطقة الجنوبية', 'Southern Region', 'southern', 'SOUT', true),
  ('b144b6c8-5555-4444-b000-000000000005', 'المنطقة الشمالية', 'Northern Region', 'northern', 'NORT', true)
on conflict (slug) do update set
  id = excluded.id,
  name_ar = excluded.name_ar,
  name_en = excluded.name_en,
  code = excluded.code,
  is_active = excluded.is_active;

-- -------------------------------------------------------------------------
-- 2. Seed Cities (25 Registered Cities with Canonical UUIDs & parent region_id)
-- -------------------------------------------------------------------------
insert into public.cities (id, name_ar, name_en, slug, code, country_code, region_id, is_active, sort_order)
values 
  ('a6f7b140-0001-4444-a000-000000000001', 'الرياض', 'Riyadh', 'riyadh', 'RIYC', 'SA', 'b144b6c8-1111-4444-b000-000000000001', true, 1),
  ('a6f7b140-0002-4444-a000-000000000002', 'جدة', 'Jeddah', 'jeddah', 'JEDC', 'SA', 'b144b6c8-2222-4444-b000-000000000002', true, 2),
  ('a6f7b140-0003-4444-a000-000000000003', 'مكة المكرمة', 'Makkah', 'makkah', 'MAKC', 'SA', 'b144b6c8-2222-4444-b000-000000000002', true, 3),
  ('a6f7b140-0004-4444-a000-000000000004', 'المدينة المنورة', 'Madinah', 'madinah', 'MEDC', 'SA', 'b144b6c8-2222-4444-b000-000000000002', true, 4),
  ('a6f7b140-0005-4444-a000-000000000005', 'الدمام', 'Dammam', 'dammam', 'DAMC', 'SA', 'b144b6c8-3333-4444-b000-000000000003', true, 5),
  ('a6f7b140-0006-4444-a000-000000000006', 'الخبر', 'Khobar', 'khobar', 'KHBC', 'SA', 'b144b6c8-3333-4444-b000-000000000003', true, 6),
  ('a6f7b140-0007-4444-a000-000000000007', 'الظهران', 'Dhahran', 'dhahran', 'DHAC', 'SA', 'b144b6c8-3333-4444-b000-000000000003', true, 7),
  ('a6f7b140-0008-4444-a000-000000000008', 'الطائف', 'Taif', 'taif', 'TAIC', 'SA', 'b144b6c8-2222-4444-b000-000000000002', true, 8),
  ('a6f7b140-0009-4444-a000-000000000009', 'تبوك', 'Tabuk', 'tabuk', 'TABC', 'SA', 'b144b6c8-5555-4444-b000-000000000005', true, 9),
  ('a6f7b140-0010-4444-a000-000000000010', 'بريدة', 'Buraydah', 'buraydah', 'BURC', 'SA', 'b144b6c8-1111-4444-b000-000000000001', true, 10),
  ('a6f7b140-0011-4444-a000-000000000011', 'خميس مشيط', 'Khamis Mushait', 'khamis-mushait', 'KHMC', 'SA', 'b144b6c8-4444-4444-b000-000000000004', true, 11),
  ('a6f7b140-0012-4444-a000-000000000012', 'أبها', 'Abha', 'abha', 'ABHC', 'SA', 'b144b6c8-4444-4444-b000-000000000004', true, 12),
  ('a6f7b140-0013-4444-a000-000000000013', 'حائل', 'Hail', 'hail', 'HAIC', 'SA', 'b144b6c8-1111-4444-b000-000000000001', true, 13),
  ('a6f7b140-0014-4444-a000-000000000014', 'جازان', 'Jazan', 'jazan', 'JAZC', 'SA', 'b144b6c8-4444-4444-b000-000000000004', true, 14),
  ('a6f7b140-0015-4444-a000-000000000015', 'نجران', 'Najran', 'najran', 'NAJC', 'SA', 'b144b6c8-4444-4444-b000-000000000004', true, 15),
  ('a6f7b140-0016-4444-a000-000000000016', 'الباحة', 'Al Bahah', 'al-bahah', 'BAHC', 'SA', 'b144b6c8-4444-4444-b000-000000000004', true, 16),
  ('a6f7b140-0017-4444-a000-000000000017', 'سكاكا', 'Sakaka', 'sakaka', 'SKKC', 'SA', 'b144b6c8-5555-4444-b000-000000000005', true, 17),
  ('a6f7b140-0018-4444-a000-000000000018', 'عرعر', 'Arar', 'arar', 'ARAC', 'SA', 'b144b6c8-5555-4444-b000-000000000005', true, 18),
  ('a6f7b140-0019-4444-a000-000000000019', 'الأحساء', 'Al Ahsa', 'al-ahsa', 'AHSC', 'SA', 'b144b6c8-3333-4444-b000-000000000003', true, 19),
  ('a6f7b140-0020-4444-a000-000000000020', 'الجبيل', 'Jubail', 'jubail', 'JUBC', 'SA', 'b144b6c8-3333-4444-b000-000000000003', true, 20),
  ('a6f7b140-0021-4444-a000-000000000021', 'ينبع', 'Yanbu', 'yanbu', 'YANC', 'SA', 'b144b6c8-2222-4444-b000-000000000002', true, 21),
  ('a6f7b140-0022-4444-a000-000000000022', 'القطيف', 'Qatif', 'qatif', 'QATC', 'SA', 'b144b6c8-3333-4444-b000-000000000003', true, 22),
  ('a6f7b140-0023-4444-a000-000000000023', 'عنيزة', 'Unaizah', 'unaizah', 'UNZC', 'SA', 'b144b6c8-1111-4444-b000-000000000001', true, 23),
  ('a6f7b140-0024-4444-a000-000000000024', 'الخرج', 'Al Kharj', 'al-kharj', 'KHRC', 'SA', 'b144b6c8-1111-4444-b000-000000000001', true, 24),
  ('a6f7b140-0025-4444-a000-000000000025', 'حفر الباطن', 'Hafar Al Batin', 'hafar-al-batin', 'HAFC', 'SA', 'b144b6c8-3333-4444-b000-000000000003', true, 25)
on conflict (slug) do update set
  id = excluded.id,
  name_ar = excluded.name_ar,
  name_en = excluded.name_en,
  code = excluded.code,
  country_code = excluded.country_code,
  region_id = excluded.region_id,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

-- -------------------------------------------------------------------------
-- 3. Seed Supermarkets (12 Chains with 4-letter codes)
-- -------------------------------------------------------------------------
insert into public.supermarkets (id, name_ar, name_en, slug, code, logo_url, website_url, is_active, sort_order)
values
  ('c2cc16c2-0001-4444-b000-c00000000001', 'بنده', 'Panda', 'panda', 'PAND', '/images/supermarkets/panda.png', 'https://www.panda.com.sa', true, 1),
  ('c2cc16c2-0002-4444-b000-c00000000002', 'أسواق العثيم', 'Othaim Markets', 'othaim', 'OTHM', '/images/supermarkets/othaim.svg', 'https://www.othaimmarkets.com', true, 2),
  ('c2cc16c2-0003-4444-b000-c00000000003', 'لولو هايبر ماركت', 'LuLu Hypermarket', 'lulu', 'LULU', '/images/supermarkets/lulu.svg', 'https://www.luluhypermarket.com', true, 3),
  ('c2cc16c2-0004-4444-b000-c00000000004', 'الدانوب', 'Danube', 'danube', 'DANB', '/images/supermarkets/danube.svg', 'https://danubeco.com', true, 4),
  ('c2cc16c2-0005-4444-b000-c00000000005', 'أسواق التميمي', 'Tamimi Markets', 'tamimi', 'TAMM', '/images/supermarkets/tamimi.svg', 'https://tamimimarkets.com', true, 5),
  ('c2cc16c2-0006-4444-b000-c00000000006', 'كارفور', 'Carrefour', 'carrefour', 'CARF', '/images/supermarkets/carrefour.svg', 'https://www.carrefourksa.com', true, 6),
  ('c2cc16c2-0007-4444-b000-c00000000007', 'بن داود', 'BinDawood', 'bin-dawood', 'BNDW', '/images/supermarkets/bin-dawood.svg', 'https://www.bindawood.com', true, 7),
  ('c2cc16c2-0008-4444-b000-c00000000008', 'هايبر الوفاء', 'Hyper Alwafa', 'alwafa', 'ALWF', '/images/supermarkets/alwafa.svg', 'https://hyperalwafa.com', true, 8),
  ('c2cc16c2-0009-4444-b000-c00000000009', 'نستو هايبرماركت', 'Nesto Hypermarket', 'nesto', 'NEST', '/images/supermarkets/nesto.svg', 'https://nestogroup.com', true, 9),
  ('c2cc16c2-0010-4444-b000-c00000000010', 'أسواق المزرعة', 'Farm Superstores', 'farm', 'FARM', '/images/supermarkets/farm.svg', 'https://farm.com.sa', true, 10),
  ('c2cc16c2-0011-4444-b000-c00000000011', 'مانويل', 'Manuel Market', 'manuel', 'MANU', '/images/supermarkets/manuel.svg', 'https://manuelmarket.com', true, 11),
  ('c2cc16c2-0012-4444-b000-c00000000012', 'أسواق الراية', 'Al Raya Markets', 'raya', 'RAYA', '/images/supermarkets/raya.svg', 'https://alraya.com.sa', true, 12)
on conflict (slug) do update set
  id = excluded.id,
  name_ar = excluded.name_ar,
  name_en = excluded.name_en,
  code = excluded.code,
  logo_url = excluded.logo_url,
  website_url = excluded.website_url,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

-- -------------------------------------------------------------------------
-- 4. Seed Supermarket-Regions Mapping (Active in Riyadh & Central)
-- -------------------------------------------------------------------------
insert into public.supermarket_regions (supermarket_id, city_id, region_id, is_active)
values
  -- Panda
  ('c2cc16c2-0001-4444-b000-c00000000001', 'a6f7b140-0001-4444-a000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', true),
  -- Othaim
  ('c2cc16c2-0002-4444-b000-c00000000002', 'a6f7b140-0001-4444-a000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', true),
  -- LuLu
  ('c2cc16c2-0003-4444-b000-c00000000003', 'a6f7b140-0001-4444-a000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', true),
  -- Danube
  ('c2cc16c2-0004-4444-b000-c00000000004', 'a6f7b140-0001-4444-a000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', true),
  -- Tamimi
  ('c2cc16c2-0005-4444-b000-c00000000005', 'a6f7b140-0001-4444-a000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', true),
  -- Carrefour
  ('c2cc16c2-0006-4444-b000-c00000000006', 'a6f7b140-0001-4444-a000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', true),
  -- BinDawood
  ('c2cc16c2-0007-4444-b000-c00000000007', 'a6f7b140-0001-4444-a000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', true),
  -- Hyper Alwafa
  ('c2cc16c2-0008-4444-b000-c00000000008', 'a6f7b140-0001-4444-a000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', true),
  -- Nesto Hypermarket
  ('c2cc16c2-0009-4444-b000-c00000000009', 'a6f7b140-0001-4444-a000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', true),
  -- Farm Superstores
  ('c2cc16c2-0010-4444-b000-c00000000010', 'a6f7b140-0001-4444-a000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', true),
  -- Manuel Market
  ('c2cc16c2-0011-4444-b000-c00000000011', 'a6f7b140-0001-4444-a000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', true),
  -- Al Raya Markets
  ('c2cc16c2-0012-4444-b000-c00000000012', 'a6f7b140-0001-4444-a000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', true)
on conflict do nothing;

-- -------------------------------------------------------------------------
-- 5. Seed Categories
-- -------------------------------------------------------------------------
insert into public.categories (id, name_ar, name_en, slug, icon_name, is_active, sort_order, requires_unit_price, default_unit_type)
values
  ('d3dd37d3-0001-4444-9000-e00000000001', 'الأساسيات', 'Staples', 'staples', 'rice', true, 1, true, 'kg'),
  ('d3dd37d3-0002-4444-9000-e00000000002', 'الألبان', 'Dairy', 'dairy', 'milk', true, 2, true, 'liter'),
  ('d3dd37d3-0003-4444-9000-e00000000003', 'البيض', 'Eggs', 'eggs', 'egg', true, 3, true, 'piece'),
  ('d3dd37d3-0004-4444-9000-e00000000004', 'اللحوم والدجاج', 'Meat & Chicken', 'meat-chicken', 'drumstick', true, 4, true, 'kg'),
  ('d3dd37d3-0005-4444-9000-e00000000005', 'المجمّدات', 'Frozen Food', 'frozen', 'ice-cream', true, 5, true, 'kg'),
  ('d3dd37d3-0006-4444-9000-e00000000006', 'الأطفال', 'Baby Products', 'baby', 'baby-carriage', true, 6, true, 'diaper'),
  ('d3dd37d3-0007-4444-9000-e00000000007', 'التنظيف', 'Cleaning Essentials', 'cleaning', 'trash', true, 7, true, 'kg'),
  ('d3dd37d3-0008-4444-9000-e00000000008', 'العناية الشخصية', 'Personal Care', 'personal-care', 'user', true, 8, false, null),
  ('d3dd37d3-0009-4444-9000-e00000000009', 'المشروبات', 'Beverages', 'beverages', 'cup-soda', true, 9, true, 'liter'),
  ('d3dd37d3-0010-4444-9000-e00000000010', 'القهوة والشاي', 'Coffee & Tea', 'coffee-tea', 'coffee', true, 10, true, 'kg'),
  ('d3dd37d3-0011-4444-9000-e00000000011', 'الوجبات الخفيفة', 'Snacks', 'snacks', 'cookie', true, 11, false, null),
  ('d3dd37d3-0012-4444-9000-e00000000012', 'المعلبات', 'Canned Food', 'canned-food', 'container', true, 12, false, null),
  ('d3dd37d3-0013-4444-9000-e00000000013', 'غير غذائية', 'Non-Grocery', 'non-grocery', 'package', true, 13, false, null)
on conflict (slug) do update set
  name_ar = excluded.name_ar,
  name_en = excluded.name_en,
  icon_name = excluded.icon_name,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  requires_unit_price = excluded.requires_unit_price,
  default_unit_type = excluded.default_unit_type;

-- -------------------------------------------------------------------------
-- 6. Seed Units
-- -------------------------------------------------------------------------
insert into public.units (id, code, name_ar, name_en, symbol_ar, symbol_en, base_unit_code, conversion_to_base, is_active, sort_order)
values
  ('e4ee48e4-0001-4444-a000-f00000000001', 'kg', 'كيلوجرام', 'Kilogram', 'كجم', 'kg', 'kg', 1.0, true, 1),
  ('e4ee48e4-0002-4444-a000-f00000000002', 'g', 'جرام', 'Gram', 'جم', 'g', 'kg', 0.001, true, 2),
  ('e4ee48e4-0003-4444-a000-f00000000003', 'liter', 'لتر', 'Liter', 'لتر', 'L', 'liter', 1.0, true, 3),
  ('e4ee48e4-0004-4444-a000-f00000000004', 'ml', 'ملليلتر', 'Milliliter', 'مل', 'ml', 'liter', 0.001, true, 4),
  ('e4ee48e4-0005-4444-a000-f00000000005', 'piece', 'حبة', 'Piece', 'حبة', 'pc', 'piece', 1.0, true, 5),
  ('e4ee48e4-0006-4444-a000-f00000000006', 'pack', 'عبوة', 'Pack', 'عبوة', 'pack', 'piece', 1.0, true, 6),
  ('e4ee48e4-0007-4444-a000-f00000000007', 'diaper', 'حفاضة', 'Diaper', 'حفاضة', 'diaper', 'piece', 1.0, true, 7),
  ('e4ee48e4-0008-4444-a000-f00000000008', 'wash', 'غسلة', 'Wash', 'غسلة', 'wash', 'piece', 1.0, true, 8),
  ('e4ee48e4-0009-4444-a000-f00000000009', 'capsule', 'كبسولة', 'Capsule', 'كبسولة', 'capsule', 'piece', 1.0, true, 9)
on conflict (code) do update set
  name_ar = excluded.name_ar,
  name_en = excluded.name_en,
  symbol_ar = excluded.symbol_ar,
  symbol_en = excluded.symbol_en,
  base_unit_code = excluded.base_unit_code,
  conversion_to_base = excluded.conversion_to_base,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;
