-- =========================================================================
-- Wifran Beta Demo Seed Data
-- Script: 002_seed_beta_demo_data.sql
-- Description: Realistic demo data for QA and beta testing.
-- WARNING: Verify real weekly prices before public launch. 
-- Do not present demo prices as live offers unless manually verified.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Seed Brands
-- -------------------------------------------------------------------------
insert into public.brands (id, name_ar, name_en, slug)
values
  ('11111111-0000-0000-0000-000000000001', 'المراعي', 'Almarai', 'almarai'),
  ('11111111-0000-0000-0000-000000000002', 'نادك', 'Nadec', 'nadec'),
  ('11111111-0000-0000-0000-000000000003', 'بامبرز', 'Pampers', 'pampers'),
  ('11111111-0000-0000-0000-000000000004', 'تايد', 'Tide', 'tide'),
  ('11111111-0000-0000-0000-000000000005', 'أريال', 'Ariel', 'ariel'),
  ('11111111-0000-0000-0000-000000000006', 'السنبلة', 'Sunbulah', 'sunbulah'),
  ('11111111-0000-0000-0000-000000000007', 'أبو كاس', 'Abu Kass', 'abu-kass'),
  ('11111111-0000-0000-0000-000000000008', 'السعودية', 'Saudia', 'saudia'),
  ('11111111-0000-0000-0000-000000000009', 'نستله', 'Nestle', 'nestle'),
  ('11111111-0000-0000-0000-000000000010', 'ليبتون', 'Lipton', 'lipton')
on conflict (slug) do update set
  name_ar = excluded.name_ar,
  name_en = excluded.name_en;

-- -------------------------------------------------------------------------
-- 2. Seed Products
-- -------------------------------------------------------------------------
insert into public.products (id, brand_id, category_id, name_ar, name_en, slug)
values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'd3dd37d3-0002-4444-9000-e00000000002', 'حليب المراعي طازج ٢ لتر', 'Almarai Fresh Milk 2L', 'almarai-fresh-milk-2l'),
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000007', 'd3dd37d3-0001-4444-9000-e00000000001', 'أرز بسمتي ١٠ كجم', 'Basmati Rice 10kg', 'basmati-rice-10kg'),
  ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000003', 'd3dd37d3-0006-4444-9000-e00000000006', 'بامبرز مقاس ٤ ٧٢ حفاض', 'Pampers Size 4 72 diapers', 'pampers-size-4-72-diapers'),
  ('22222222-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000004', 'd3dd37d3-0007-4444-9000-e00000000007', 'منظف تايد ٢.٥ لتر', 'Tide Detergent 2.5L', 'tide-detergent-2-5l'),
  ('22222222-0000-0000-0000-000000000005', null,                                   'd3dd37d3-0003-4444-9000-e00000000003', 'بيض ٣٠ حبة', 'Eggs 30 pieces', 'eggs-30-pieces'),
  ('22222222-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000009', 'd3dd37d3-0009-4444-9000-e00000000009', 'ماء ٢٤ عبوة', 'Water 24 bottles', 'water-24-bottles'),
  ('22222222-0000-0000-0000-000000000007', null,                                   'd3dd37d3-0004-4444-9000-e00000000004', 'صدور دجاج ١ كجم', 'Chicken Breast 1kg', 'chicken-breast-1kg'),
  ('22222222-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000009', 'd3dd37d3-0010-4444-9000-e00000000010', 'قهوة ٢٠٠ جم', 'Coffee 200g', 'coffee-200g'),
  ('22222222-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000010', 'd3dd37d3-0010-4444-9000-e00000000010', 'شاي ١٠٠ كيس', 'Tea 100 bags', 'tea-100-bags'),
  ('22222222-0000-0000-0000-000000000010', null,                                   'd3dd37d3-0001-4444-9000-e00000000001', 'زيت طبخ ١.٨ لتر', 'Cooking Oil 1.8L', 'cooking-oil-1-8l')
on conflict (slug) do update set
  name_ar = excluded.name_ar,
  name_en = excluded.name_en;

-- -------------------------------------------------------------------------
-- 3. Seed Product Aliases
-- -------------------------------------------------------------------------
insert into public.product_aliases (product_id, alias_text)
values
  ('22222222-0000-0000-0000-000000000001', 'حليب'), ('22222222-0000-0000-0000-000000000001', 'milk'), ('22222222-0000-0000-0000-000000000001', 'لبن'),
  ('22222222-0000-0000-0000-000000000002', 'رز'), ('22222222-0000-0000-0000-000000000002', 'أرز'), ('22222222-0000-0000-0000-000000000002', 'rice'),
  ('22222222-0000-0000-0000-000000000003', 'حفاضات'), ('22222222-0000-0000-0000-000000000003', 'diapers'),
  ('22222222-0000-0000-0000-000000000004', 'منظف'), ('22222222-0000-0000-0000-000000000004', 'detergent'),
  ('22222222-0000-0000-0000-000000000005', 'بيض'), ('22222222-0000-0000-0000-000000000005', 'eggs'),
  ('22222222-0000-0000-0000-000000000006', 'ماء'), ('22222222-0000-0000-0000-000000000006', 'water'),
  ('22222222-0000-0000-0000-000000000007', 'دجاج'), ('22222222-0000-0000-0000-000000000007', 'chicken'),
  ('22222222-0000-0000-0000-000000000008', 'قهوة'), ('22222222-0000-0000-0000-000000000008', 'coffee'),
  ('22222222-0000-0000-0000-000000000009', 'شاي'), ('22222222-0000-0000-0000-000000000009', 'tea'),
  ('22222222-0000-0000-0000-000000000010', 'زيت'), ('22222222-0000-0000-0000-000000000010', 'oil')
on conflict do nothing;

-- -------------------------------------------------------------------------
-- 4. Seed Offer Sources
-- -------------------------------------------------------------------------
insert into public.offer_sources (id, source_type, title, valid_from, valid_to)
values
  ('33333333-0000-0000-0000-000000000001', 'leaflet', 'Panda Weekly Leaflet', current_date - interval '2 days', current_date + interval '5 days'),
  ('33333333-0000-0000-0000-000000000002', 'leaflet', 'Othaim Weekly Leaflet', current_date - interval '1 days', current_date + interval '6 days'),
  ('33333333-0000-0000-0000-000000000003', 'leaflet', 'LuLu Weekly Leaflet', current_date - interval '3 days', current_date + interval '4 days')
on conflict do nothing;

-- -------------------------------------------------------------------------
-- 5. Seed Offers (Active Published)
-- -------------------------------------------------------------------------
insert into public.offers (
  id, supermarket_id, location_scope, city_id, region_id, category_id, brand_id, product_id,
  title_ar, title_en, offer_price, original_price, discount_amount, discount_percentage,
  pack_size_value, pack_size_unit, pack_quantity, unit_price, unit_price_unit,
  offer_start_date, offer_end_date, status, source_id, deal_score, deal_label
)
values
  -- Offer 1: Milk at Panda
  (gen_random_uuid(), 'c2cc16c2-0001-4444-b000-c00000000001', 'city', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0002-4444-9000-e00000000002', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001',
   'حليب المراعي طازج ٢ لتر', 'Almarai Fresh Milk 2L', 8.50, 11.00, 2.50, 22.7, 2, 'liter', 1, 4.25, 'liter', current_date - interval '2 days', current_date + interval '5 days', 'published', '33333333-0000-0000-0000-000000000001', 80, 'Great Deal'),
  
  -- Offer 2: Rice at Othaim
  (gen_random_uuid(), 'c2cc16c2-0002-4444-b000-c00000000002', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0001-4444-9000-e00000000001', '11111111-0000-0000-0000-000000000007', '22222222-0000-0000-0000-000000000002',
   'أرز أبو كاس ١٠ كجم', 'Abu Kass Basmati Rice 10kg', 69.95, 89.95, 20.00, 22.2, 10, 'kg', 1, 6.99, 'kg', current_date - interval '1 days', current_date + interval '6 days', 'published', '33333333-0000-0000-0000-000000000002', 85, 'Amazing Deal'),
  
  -- Offer 3: Diapers at LuLu
  (gen_random_uuid(), 'c2cc16c2-0003-4444-b000-c00000000003', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0006-4444-9000-e00000000006', '11111111-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000003',
   'بامبرز مقاس ٤ ٧٢ حفاض', 'Pampers Size 4 72 diapers', 55.00, 75.00, 20.00, 26.6, 72, 'piece', 1, 0.76, 'piece', current_date - interval '3 days', current_date + interval '4 days', 'published', '33333333-0000-0000-0000-000000000003', 70, 'Good Deal'),
  
  -- Offer 4: Detergent at Danube
  (gen_random_uuid(), 'c2cc16c2-0004-4444-b000-c00000000004', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0007-4444-9000-e00000000007', '11111111-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000004',
   'منظف تايد ٢.٥ لتر', 'Tide Detergent 2.5L', 28.95, 42.00, 13.05, 31.0, 2.5, 'liter', 1, 11.58, 'liter', current_date - interval '2 days', current_date + interval '5 days', 'published', null, 90, 'Hot Deal'),
  
  -- Offer 5: Eggs at Tamimi
  (gen_random_uuid(), 'c2cc16c2-0005-4444-b000-c00000000005', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0003-4444-9000-e00000000003', null, '22222222-0000-0000-0000-000000000005',
   'بيض ٣٠ حبة كبير', 'Large Eggs 30 pieces', 16.50, 19.50, 3.00, 15.3, 30, 'piece', 1, 0.55, 'piece', current_date - interval '1 days', current_date + interval '5 days', 'published', null, 50, null),
  
  -- Offer 6: Water at Carrefour
  (gen_random_uuid(), 'c2cc16c2-0006-4444-b000-c00000000006', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0009-4444-9000-e00000000009', '11111111-0000-0000-0000-000000000009', '22222222-0000-0000-0000-000000000006',
   'مياه نستله ٢٤ × ٣٣٠ مل', 'Nestle Water 24x330ml', 10.95, 14.50, 3.55, 24.4, 7.92, 'liter', 24, 1.38, 'liter', current_date - interval '2 days', current_date + interval '3 days', 'published', null, 60, null),
  
  -- Offer 7: Chicken at Panda
  (gen_random_uuid(), 'c2cc16c2-0001-4444-b000-c00000000001', 'city', 'a6f7b140-0002-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-2222-477c-a496-d3c52e46b3f2', 'd3dd37d3-0004-4444-9000-e00000000004', null, '22222222-0000-0000-0000-000000000007',
   'صدور دجاج طازجة ١ كجم', 'Fresh Chicken Breast 1kg', 19.95, 25.00, 5.05, 20.2, 1, 'kg', 1, 19.95, 'kg', current_date - interval '2 days', current_date + interval '5 days', 'published', '33333333-0000-0000-0000-000000000001', 75, 'Good Deal'),
  
  -- Offer 8: Coffee at Othaim
  (gen_random_uuid(), 'c2cc16c2-0002-4444-b000-c00000000002', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0010-4444-9000-e00000000010', '11111111-0000-0000-0000-000000000009', '22222222-0000-0000-0000-000000000008',
   'نسكافيه جولد ٢٠٠ جم', 'Nescafe Gold 200g', 24.50, 32.00, 7.50, 23.4, 200, 'g', 1, 122.50, 'kg', current_date - interval '1 days', current_date + interval '6 days', 'published', '33333333-0000-0000-0000-000000000002', 80, 'Great Deal'),
  
  -- Offer 9: Tea at LuLu
  (gen_random_uuid(), 'c2cc16c2-0003-4444-b000-c00000000003', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0010-4444-9000-e00000000010', '11111111-0000-0000-0000-000000000010', '22222222-0000-0000-0000-000000000009',
   'شاي ليبتون ١٠٠ كيس', 'Lipton Tea 100 bags', 12.95, 17.50, 4.55, 26.0, 100, 'piece', 1, 0.12, 'piece', current_date - interval '3 days', current_date + interval '4 days', 'published', '33333333-0000-0000-0000-000000000003', 70, 'Good Deal'),
  
  -- Offer 10: Oil at Danube
  (gen_random_uuid(), 'c2cc16c2-0004-4444-b000-c00000000004', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0001-4444-9000-e00000000001', null, '22222222-0000-0000-0000-000000000010',
   'زيت طبخ ١.٨ لتر عبوتين', 'Cooking Oil 1.8L x 2', 32.50, 45.00, 12.50, 27.7, 3.6, 'liter', 2, 9.02, 'liter', current_date - interval '2 days', current_date + interval '5 days', 'published', null, 85, 'Amazing Deal'),
  
  -- Bulk generator for more active offers
  (gen_random_uuid(), 'c2cc16c2-0005-4444-b000-c00000000005', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0002-4444-9000-e00000000002', '11111111-0000-0000-0000-000000000002', null,
   'حليب نادك طويل الأجل ١ لتر ٤ حبات', 'Nadec UHT Milk 1L x 4', 18.00, 22.00, 4.00, 18.1, 4, 'liter', 4, 4.50, 'liter', current_date - interval '1 days', current_date + interval '6 days', 'published', null, 65, null),
  (gen_random_uuid(), 'c2cc16c2-0006-4444-b000-c00000000006', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0005-4444-9000-e00000000005', '11111111-0000-0000-0000-000000000006', null,
   'عجينة بف باستري السنبلة ٤٠٠ جم', 'Sunbulah Puff Pastry 400g', 8.50, 12.00, 3.50, 29.1, 400, 'g', 1, 21.25, 'kg', current_date - interval '2 days', current_date + interval '5 days', 'published', null, 75, 'Good Deal'),
  (gen_random_uuid(), 'c2cc16c2-0007-4444-b000-c00000000007', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0008-4444-9000-e00000000008', null, null,
   'شامبو دوف ٤٠٠ مل', 'Dove Shampoo 400ml', 15.00, 22.00, 7.00, 31.8, 400, 'ml', 1, 37.50, 'liter', current_date - interval '1 days', current_date + interval '6 days', 'published', null, 80, 'Great Deal'),
  (gen_random_uuid(), 'c2cc16c2-0001-4444-b000-c00000000001', 'region', null, 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0011-4444-9000-e00000000011', null, null,
   'شيبس ليز ١٦٥ جم', 'Lays Chips 165g', 5.95, 7.50, 1.55, 20.6, 165, 'g', 1, 36.06, 'kg', current_date - interval '2 days', current_date + interval '5 days', 'published', '33333333-0000-0000-0000-000000000001', 60, null),
  (gen_random_uuid(), 'c2cc16c2-0002-4444-b000-c00000000002', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0012-4444-9000-e00000000012', null, null,
   'تونة قودي خفيف ١٨٥ جم', 'Goody Light Tuna 185g', 4.50, 6.00, 1.50, 25.0, 185, 'g', 1, 24.32, 'kg', current_date - interval '1 days', current_date + interval '6 days', 'published', '33333333-0000-0000-0000-000000000002', 65, null),
  (gen_random_uuid(), 'c2cc16c2-0003-4444-b000-c00000000003', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0004-4444-9000-e00000000004', null, null,
   'لحم غنم بالعظم ١ كجم', 'Lamb with Bone 1kg', 39.95, 49.95, 10.00, 20.0, 1, 'kg', 1, 39.95, 'kg', current_date - interval '3 days', current_date + interval '4 days', 'published', '33333333-0000-0000-0000-000000000003', 70, 'Good Deal');

-- -------------------------------------------------------------------------
-- 6. Seed Offers (Expired Published)
-- -------------------------------------------------------------------------
insert into public.offers (
  id, supermarket_id, location_scope, city_id, region_id, category_id,
  title_ar, title_en, offer_price, original_price,
  offer_start_date, offer_end_date, status
)
values
  (gen_random_uuid(), 'c2cc16c2-0001-4444-b000-c00000000001', 'national', null, null, 'd3dd37d3-0001-4444-9000-e00000000001',
   'مكرونة قودي منتهية العرض', 'Goody Pasta Expired', 3.50, 5.00, current_date - interval '10 days', current_date - interval '2 days', 'published'),
  (gen_random_uuid(), 'c2cc16c2-0002-4444-b000-c00000000002', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0002-4444-9000-e00000000002',
   'جبنة المراعي منتهية العرض', 'Almarai Cheese Expired', 10.00, 15.00, current_date - interval '14 days', current_date - interval '7 days', 'published'),
  (gen_random_uuid(), 'c2cc16c2-0003-4444-b000-c00000000003', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0003-4444-9000-e00000000003',
   'عرض بيض منتهي', 'Expired Eggs Offer', 12.00, 18.00, current_date - interval '20 days', current_date - interval '10 days', 'published'),
  (gen_random_uuid(), 'c2cc16c2-0004-4444-b000-c00000000004', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0004-4444-9000-e00000000004',
   'عرض دجاج منتهي', 'Expired Chicken Offer', 14.00, 20.00, current_date - interval '8 days', current_date - interval '1 days', 'published'),
  (gen_random_uuid(), 'c2cc16c2-0005-4444-b000-c00000000005', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0005-4444-9000-e00000000005',
   'خضار مجمدة منتهية', 'Expired Frozen Veggies', 6.00, 9.00, current_date - interval '15 days', current_date - interval '5 days', 'published');

-- -------------------------------------------------------------------------
-- 7. Seed Offers (Needs Review)
-- -------------------------------------------------------------------------
insert into public.offers (
  id, supermarket_id, location_scope, city_id, region_id, category_id,
  title_ar, title_en, offer_price, original_price,
  offer_start_date, offer_end_date, status
)
values
  (gen_random_uuid(), 'c2cc16c2-0001-4444-b000-c00000000001', 'national', null, null, 'd3dd37d3-0001-4444-9000-e00000000001',
   'سكر الأسرة ١٠ كجم بانتظار المراجعة', 'Osra Sugar 10kg Needs Review', 29.95, 36.00, current_date, current_date + interval '7 days', 'needs_review'),
  (gen_random_uuid(), 'c2cc16c2-0002-4444-b000-c00000000002', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0002-4444-9000-e00000000002',
   'لبن المراعي بانتظار المراجعة', 'Almarai Laban Needs Review', 7.50, 9.00, current_date, current_date + interval '7 days', 'needs_review'),
  (gen_random_uuid(), 'c2cc16c2-0003-4444-b000-c00000000003', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0009-4444-9000-e00000000009',
   'عصير ربيع بانتظار المراجعة', 'Rabea Juice Needs Review', 11.00, 15.00, current_date, current_date + interval '7 days', 'needs_review'),
  (gen_random_uuid(), 'c2cc16c2-0004-4444-b000-c00000000004', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0006-4444-9000-e00000000006',
   'حليب أطفال بانتظار المراجعة', 'Baby Formula Needs Review', 65.00, 80.00, current_date, current_date + interval '7 days', 'needs_review'),
  (gen_random_uuid(), 'c2cc16c2-0005-4444-b000-c00000000005', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0007-4444-9000-e00000000007',
   'صابون غسيل بانتظار المراجعة', 'Washing Soap Needs Review', 19.95, 25.00, current_date, current_date + interval '7 days', 'needs_review');

-- -------------------------------------------------------------------------
-- 8. Seed Offers (Draft & Rejected)
-- -------------------------------------------------------------------------
insert into public.offers (
  id, supermarket_id, location_scope, city_id, region_id, category_id,
  title_ar, title_en, offer_price, original_price,
  offer_start_date, offer_end_date, status
)
values
  -- Drafts
  (gen_random_uuid(), 'c2cc16c2-0001-4444-b000-c00000000001', 'national', null, null, 'd3dd37d3-0001-4444-9000-e00000000001',
   'مسودة عرض غير مكتمل', 'Incomplete Draft Offer', 9.99, null, null, current_date + interval '7 days', 'draft'),
  (gen_random_uuid(), 'c2cc16c2-0002-4444-b000-c00000000002', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0002-4444-9000-e00000000002',
   'مسودة جبن', 'Cheese Draft', 15.00, 20.00, null, current_date + interval '7 days', 'draft'),
  (gen_random_uuid(), 'c2cc16c2-0003-4444-b000-c00000000003', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0003-4444-9000-e00000000003',
   'مسودة أخرى', 'Another Draft', 5.00, null, null, current_date + interval '7 days', 'draft'),
  
  -- Rejected
  (gen_random_uuid(), 'c2cc16c2-0004-4444-b000-c00000000004', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0001-4444-9000-e00000000001',
   'عرض مرفوض - السعر خاطئ', 'Rejected Offer - Wrong Price', 1.00, 50.00, current_date, current_date + interval '7 days', 'rejected'),
  (gen_random_uuid(), 'c2cc16c2-0005-4444-b000-c00000000005', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0002-4444-9000-e00000000002',
   'عرض مرفوض - مكرر', 'Rejected Offer - Duplicate', 10.00, 15.00, current_date, current_date + interval '7 days', 'rejected'),
  (gen_random_uuid(), 'c2cc16c2-0006-4444-b000-c00000000006', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0003-4444-9000-e00000000003',
   'عرض مرفوض - جودة رديئة', 'Rejected Offer - Poor Quality', 5.00, 7.00, current_date, current_date + interval '7 days', 'rejected');

-- -------------------------------------------------------------------------
-- 9. Seed Offers (Future Start)
-- -------------------------------------------------------------------------
insert into public.offers (
  id, supermarket_id, location_scope, city_id, region_id, category_id,
  title_ar, title_en, offer_price, original_price,
  offer_start_date, offer_end_date, status
)
values
  (gen_random_uuid(), 'c2cc16c2-0001-4444-b000-c00000000001', 'national', null, null, 'd3dd37d3-0001-4444-9000-e00000000001',
   'عرض يبدأ غداً', 'Offer Starts Tomorrow', 20.00, 30.00, current_date + interval '1 days', current_date + interval '8 days', 'published'),
  (gen_random_uuid(), 'c2cc16c2-0002-4444-b000-c00000000002', 'city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'd3dd37d3-0002-4444-9000-e00000000002',
   'عرض الأسبوع القادم', 'Next Week Offer', 15.00, 25.00, current_date + interval '5 days', current_date + interval '12 days', 'published');

-- No materialized views to refresh in the current schema.
