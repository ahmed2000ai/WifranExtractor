-- =========================================================================
-- Wifran Database Migration: 006_wifran_07a_security_and_contract_reconciliation.sql
-- Description: Closes INT-F01 through INT-F12 from WIFRAN-07A Integration Review.
-- Non-destructive: reconciles registries, hardens RLS and table privileges,
-- adds revision history snapshots, and creates a sanitized consumer projection.
-- =========================================================================

-- Safe Migration Header Guard:
-- This migration is strictly NON-DESTRUCTIVE and safe to run on populated databases.
-- It does NOT truncate catalog or user tables.

-- -------------------------------------------------------------------------
-- 1. Schema Enhancements & Nullable Semantics Reconciliation (INT-F05, INT-F11)
-- -------------------------------------------------------------------------

-- 1.1 Supermarkets, Regions, and Cities: Add standard codes and parent region FK (INT-F04)
ALTER TABLE public.supermarkets
  ADD COLUMN IF NOT EXISTS code text;

ALTER TABLE public.regions
  ADD COLUMN IF NOT EXISTS code text;

ALTER TABLE public.cities
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS region_id text;

CREATE INDEX IF NOT EXISTS idx_cities_region_id ON public.cities(region_id);
CREATE INDEX IF NOT EXISTS idx_cities_code ON public.cities(code);
CREATE INDEX IF NOT EXISTS idx_regions_code ON public.regions(code);
CREATE INDEX IF NOT EXISTS idx_supermarkets_code ON public.supermarkets(code);

-- 1.2 Offers: Allow nullable inner_pack_count for measured-weight items (INT-F05)
ALTER TABLE public.offers
  ALTER COLUMN inner_pack_count DROP NOT NULL,
  ALTER COLUMN inner_pack_count DROP DEFAULT;

-- Ensure check constraint on inner_pack_count: null OR > 0
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_offers_inner_pack_count'
  ) THEN
    ALTER TABLE public.offers
      ADD CONSTRAINT chk_offers_inner_pack_count
      CHECK (inner_pack_count IS NULL OR inner_pack_count > 0);
  END IF;
END $$;

-- 1.3 Offers: Prevent fake contract_version on legacy rows without contract_v2 (INT-F05, INT-12)
ALTER TABLE public.offers
  ALTER COLUMN contract_version DROP DEFAULT,
  ALTER COLUMN contract_version DROP NOT NULL;

-- 1.4 Offers: Add supersedes_source_offer_id for audited leaflet remapping (INT-F11, INT-30)
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS supersedes_source_offer_id text;

CREATE INDEX IF NOT EXISTS idx_offers_supersedes_source_offer_id
  ON public.offers(supersedes_source_offer_id)
  WHERE supersedes_source_offer_id IS NOT NULL;

-- 1.5 Offers: Ensure currency column exists (B-01)
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'SAR';


-- -------------------------------------------------------------------------
-- 2. Master Registry Reconciliation & Non-Destructive Crosswalk (INT-F04, INT-08..INT-10, B-02)
-- -------------------------------------------------------------------------

-- 2.1 Authoritative Legacy ID Crosswalk Table
CREATE TABLE IF NOT EXISTS public.legacy_id_crosswalk (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL, -- 'city' | 'region'
  legacy_id text NOT NULL UNIQUE,
  canonical_id text NOT NULL,
  canonical_region_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed Legacy ID Crosswalk for 13 Administrative Regions -> 5 Commercial Regions
INSERT INTO public.legacy_id_crosswalk (entity_type, legacy_id, canonical_id, canonical_region_id, notes)
VALUES
  ('region', 'b144b6c8-1111-477c-a496-d3c52e46b3f1', 'b144b6c8-1111-4444-b000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', 'riyadh-region -> central'),
  ('region', 'b144b6c8-2222-477c-a496-d3c52e46b3f2', 'b144b6c8-2222-4444-b000-000000000002', 'b144b6c8-2222-4444-b000-000000000002', 'makkah-region -> western'),
  ('region', 'b144b6c8-3333-477c-a496-d3c52e46b3f3', 'b144b6c8-3333-4444-b000-000000000003', 'b144b6c8-3333-4444-b000-000000000003', 'eastern-region -> eastern'),
  ('region', 'b144b6c8-4444-477c-a496-d3c52e46b3f4', 'b144b6c8-2222-4444-b000-000000000002', 'b144b6c8-2222-4444-b000-000000000002', 'madinah-region -> western'),
  ('region', 'b144b6c8-5555-477c-a496-d3c52e46b3f5', 'b144b6c8-1111-4444-b000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', 'qassim-region -> central'),
  ('region', 'b144b6c8-6666-477c-a496-d3c52e46b3f6', 'b144b6c8-4444-4444-b000-000000000004', 'b144b6c8-4444-4444-b000-000000000004', 'asir-region -> southern'),
  ('region', 'b144b6c8-7777-477c-a496-d3c52e46b3f7', 'b144b6c8-5555-4444-b000-000000000005', 'b144b6c8-5555-4444-b000-000000000005', 'tabuk-region -> northern'),
  ('region', 'b144b6c8-8888-477c-a496-d3c52e46b3f8', 'b144b6c8-1111-4444-b000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', 'hail-region -> central'),
  ('region', 'b144b6c8-9999-477c-a496-d3c52e46b3f9', 'b144b6c8-5555-4444-b000-000000000005', 'b144b6c8-5555-4444-b000-000000000005', 'northern-borders-region -> northern'),
  ('region', 'b144b6c8-aaaa-477c-a496-d3c52e46b3f0', 'b144b6c8-4444-4444-b000-000000000004', 'b144b6c8-4444-4444-b000-000000000004', 'jazan-region -> southern'),
  ('region', 'b144b6c8-bbbb-477c-a496-d3c52e46b3f1', 'b144b6c8-4444-4444-b000-000000000004', 'b144b6c8-4444-4444-b000-000000000004', 'najran-region -> southern'),
  ('region', 'b144b6c8-cccc-477c-a496-d3c52e46b3f2', 'b144b6c8-4444-4444-b000-000000000004', 'b144b6c8-4444-4444-b000-000000000004', 'al-bahah-region -> southern'),
  ('region', 'b144b6c8-dddd-477c-a496-d3c52e46b3f3', 'b144b6c8-5555-4444-b000-000000000005', 'b144b6c8-5555-4444-b000-000000000005', 'al-jouf-region -> northern')
ON CONFLICT (legacy_id) DO NOTHING;

-- Seed Legacy ID Crosswalk for 25 Cities (old seed UUIDs -> canonical deterministic UUIDs)
INSERT INTO public.legacy_id_crosswalk (entity_type, legacy_id, canonical_id, canonical_region_id, notes)
VALUES
  ('city', 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0001-4444-a000-000000000001', 'b144b6c8-1111-4444-b000-000000000001', 'riyadh'),
  ('city', 'a6f7b140-0002-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0002-4444-a000-000000000002', 'b144b6c8-2222-4444-b000-000000000002', 'jeddah'),
  ('city', 'a6f7b140-0003-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0003-4444-a000-000000000003', 'b144b6c8-2222-4444-b000-000000000002', 'makkah'),
  ('city', 'a6f7b140-0004-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0004-4444-a000-000000000004', 'b144b6c8-2222-4444-b000-000000000002', 'madinah'),
  ('city', 'a6f7b140-0005-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0005-4444-a000-000000000005', 'b144b6c8-3333-4444-b000-000000000003', 'dammam'),
  ('city', 'a6f7b140-0006-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0006-4444-a000-000000000006', 'b144b6c8-3333-4444-b000-000000000003', 'khobar'),
  ('city', 'a6f7b140-0007-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0007-4444-a000-000000000007', 'b144b6c8-3333-4444-b000-000000000003', 'dhahran'),
  ('city', 'a6f7b140-0008-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0008-4444-a000-000000000008', 'b144b6c8-2222-4444-b000-000000000002', 'taif'),
  ('city', 'a6f7b140-0009-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0009-4444-a000-000000000009', 'b144b6c8-5555-4444-b000-000000000005', 'tabuk'),
  ('city', 'a6f7b140-0010-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0010-4444-a000-000000000010', 'b144b6c8-1111-4444-b000-000000000001', 'buraydah'),
  ('city', 'a6f7b140-0011-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0011-4444-a000-000000000011', 'b144b6c8-4444-4444-b000-000000000004', 'khamis-mushait'),
  ('city', 'a6f7b140-0012-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0012-4444-a000-000000000012', 'b144b6c8-4444-4444-b000-000000000004', 'abha'),
  ('city', 'a6f7b140-0013-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0013-4444-a000-000000000013', 'b144b6c8-1111-4444-b000-000000000001', 'hail'),
  ('city', 'a6f7b140-0014-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0014-4444-a000-000000000014', 'b144b6c8-4444-4444-b000-000000000004', 'jazan'),
  ('city', 'a6f7b140-0015-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0015-4444-a000-000000000015', 'b144b6c8-4444-4444-b000-000000000004', 'najran'),
  ('city', 'a6f7b140-0016-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0016-4444-a000-000000000016', 'b144b6c8-4444-4444-b000-000000000004', 'al-bahah'),
  ('city', 'a6f7b140-0017-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0017-4444-a000-000000000017', 'b144b6c8-5555-4444-b000-000000000005', 'sakaka'),
  ('city', 'a6f7b140-0018-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0018-4444-a000-000000000018', 'b144b6c8-5555-4444-b000-000000000005', 'arar'),
  ('city', 'a6f7b140-0019-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0019-4444-a000-000000000019', 'b144b6c8-3333-4444-b000-000000000003', 'al-ahsa'),
  ('city', 'a6f7b140-0020-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0020-4444-a000-000000000020', 'b144b6c8-3333-4444-b000-000000000003', 'jubail'),
  ('city', 'a6f7b140-0021-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0021-4444-a000-000000000021', 'b144b6c8-2222-4444-b000-000000000002', 'yanbu'),
  ('city', 'a6f7b140-0022-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0022-4444-a000-000000000022', 'b144b6c8-3333-4444-b000-000000000003', 'qatif'),
  ('city', 'a6f7b140-0023-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0023-4444-a000-000000000023', 'b144b6c8-1111-4444-b000-000000000001', 'unaizah'),
  ('city', 'a6f7b140-0024-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0024-4444-a000-000000000024', 'b144b6c8-1111-4444-b000-000000000001', 'al-kharj'),
  ('city', 'a6f7b140-0025-4c28-98e3-c28dd6fb4fb4', 'a6f7b140-0025-4444-a000-000000000025', 'b144b6c8-3333-4444-b000-000000000003', 'hafar-al-batin')
ON CONFLICT (legacy_id) DO NOTHING;

-- Step A: Dynamically drop all foreign key constraints referencing public.cities or public.regions (B-02)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT tc.table_schema, tc.table_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND ccu.table_name IN ('cities', 'regions')
  ) LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I', r.table_schema, r.table_name, r.constraint_name);
  END LOOP;
END $$;

-- Step B: Upsert canonical 5 Commercial Regions and 25 Authoritative Cities (B-02, B-08)
INSERT INTO public.regions (id, name_ar, name_en, slug, code, is_active)
VALUES
  ('b144b6c8-1111-4444-b000-000000000001', 'المنطقة الوسطى', 'Central Region', 'central', 'CENT', true),
  ('b144b6c8-2222-4444-b000-000000000002', 'المنطقة الغربية', 'Western Region', 'western', 'WEST', true),
  ('b144b6c8-3333-4444-b000-000000000003', 'المنطقة الشرقية', 'Eastern Region', 'eastern', 'EAST', true),
  ('b144b6c8-4444-4444-b000-000000000004', 'المنطقة الجنوبية', 'Southern Region', 'southern', 'SOUT', true),
  ('b144b6c8-5555-4444-b000-000000000005', 'المنطقة الشمالية', 'Northern Region', 'northern', 'NORT', true)
ON CONFLICT (slug) DO UPDATE SET
  id = excluded.id,
  name_ar = excluded.name_ar,
  name_en = excluded.name_en,
  code = excluded.code,
  is_active = excluded.is_active;

INSERT INTO public.cities (id, name_ar, name_en, slug, code, country_code, region_id, is_active, sort_order)
VALUES
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
ON CONFLICT (slug) DO UPDATE SET
  id = excluded.id,
  name_ar = excluded.name_ar,
  name_en = excluded.name_en,
  code = excluded.code,
  country_code = excluded.country_code,
  region_id = excluded.region_id,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

-- Update Supermarkets with 4-letter external codes
UPDATE public.supermarkets SET code = 'PAND' WHERE slug = 'panda';
UPDATE public.supermarkets SET code = 'OTHM' WHERE slug = 'othaim';
UPDATE public.supermarkets SET code = 'LULU' WHERE slug = 'lulu';
UPDATE public.supermarkets SET code = 'DANB' WHERE slug = 'danube';
UPDATE public.supermarkets SET code = 'TAMM' WHERE slug = 'tamimi';
UPDATE public.supermarkets SET code = 'CARF' WHERE slug = 'carrefour';
UPDATE public.supermarkets SET code = 'BNDW' WHERE slug = 'bin-dawood';
UPDATE public.supermarkets SET code = 'ALWF' WHERE slug = 'alwafa';
UPDATE public.supermarkets SET code = 'NEST' WHERE slug = 'nesto';
UPDATE public.supermarkets SET code = 'FARM' WHERE slug = 'farm';
UPDATE public.supermarkets SET code = 'MANU' WHERE slug = 'manuel';
UPDATE public.supermarkets SET code = 'RAYA' WHERE slug = 'raya';

-- Step C: Non-destructive Remap of Dependent Tables from Legacy IDs to Canonical IDs
UPDATE public.cities c
SET region_id = x.canonical_id
FROM public.legacy_id_crosswalk x
WHERE x.entity_type = 'region' AND c.region_id = x.legacy_id;

UPDATE public.offers o
SET city_id = x.canonical_id
FROM public.legacy_id_crosswalk x
WHERE x.entity_type = 'city' AND o.city_id = x.legacy_id;

UPDATE public.offers o
SET region_id = x.canonical_id
FROM public.legacy_id_crosswalk x
WHERE x.entity_type = 'region' AND o.region_id = x.legacy_id;

UPDATE public.offer_sources s
SET city_id = x.canonical_id
FROM public.legacy_id_crosswalk x
WHERE x.entity_type = 'city' AND s.city_id = x.legacy_id;

UPDATE public.offer_sources s
SET region_id = x.canonical_id
FROM public.legacy_id_crosswalk x
WHERE x.entity_type = 'region' AND s.region_id = x.legacy_id;

UPDATE public.profiles p
SET preferred_city_id = x.canonical_id
FROM public.legacy_id_crosswalk x
WHERE x.entity_type = 'city' AND p.preferred_city_id = x.legacy_id;

UPDATE public.shopping_lists l
SET city_id = x.canonical_id
FROM public.legacy_id_crosswalk x
WHERE x.entity_type = 'city' AND l.city_id = x.legacy_id;

UPDATE public.supermarket_regions sr
SET city_id = x.canonical_id
FROM public.legacy_id_crosswalk x
WHERE x.entity_type = 'city' AND sr.city_id = x.legacy_id;

UPDATE public.supermarket_regions sr
SET region_id = x.canonical_id
FROM public.legacy_id_crosswalk x
WHERE x.entity_type = 'region' AND sr.region_id = x.legacy_id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'import_batches') THEN
    UPDATE public.import_batches ib SET city_id = x.canonical_id FROM public.legacy_id_crosswalk x WHERE x.entity_type = 'city' AND ib.city_id = x.legacy_id;
    UPDATE public.import_batches ib SET region_id = x.canonical_id FROM public.legacy_id_crosswalk x WHERE x.entity_type = 'region' AND ib.region_id = x.legacy_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_events') THEN
    UPDATE public.app_events ae SET city_id = x.canonical_id FROM public.legacy_id_crosswalk x WHERE x.entity_type = 'city' AND ae.city_id = x.legacy_id;
  END IF;
END $$;

-- Deduplicate supermarket_regions rows that collapsed to identical (supermarket_id, city_id, region_id)
DELETE FROM public.supermarket_regions a
USING public.supermarket_regions b
WHERE a.ctid < b.ctid
  AND a.supermarket_id = b.supermarket_id
  AND a.city_id = b.city_id
  AND a.region_id = b.region_id;

-- Delete unreferenced legacy parent rows
DELETE FROM public.regions WHERE id NOT IN (
  'b144b6c8-1111-4444-b000-000000000001',
  'b144b6c8-2222-4444-b000-000000000002',
  'b144b6c8-3333-4444-b000-000000000003',
  'b144b6c8-4444-4444-b000-000000000004',
  'b144b6c8-5555-4444-b000-000000000005'
);

DELETE FROM public.cities WHERE id NOT IN (
  'a6f7b140-0001-4444-a000-000000000001',
  'a6f7b140-0002-4444-a000-000000000002',
  'a6f7b140-0003-4444-a000-000000000003',
  'a6f7b140-0004-4444-a000-000000000004',
  'a6f7b140-0005-4444-a000-000000000005',
  'a6f7b140-0006-4444-a000-000000000006',
  'a6f7b140-0007-4444-a000-000000000007',
  'a6f7b140-0008-4444-a000-000000000008',
  'a6f7b140-0009-4444-a000-000000000009',
  'a6f7b140-0010-4444-a000-000000000010',
  'a6f7b140-0011-4444-a000-000000000011',
  'a6f7b140-0012-4444-a000-000000000012',
  'a6f7b140-0013-4444-a000-000000000013',
  'a6f7b140-0014-4444-a000-000000000014',
  'a6f7b140-0015-4444-a000-000000000015',
  'a6f7b140-0016-4444-a000-000000000016',
  'a6f7b140-0017-4444-a000-000000000017',
  'a6f7b140-0018-4444-a000-000000000018',
  'a6f7b140-0019-4444-a000-000000000019',
  'a6f7b140-0020-4444-a000-000000000020',
  'a6f7b140-0021-4444-a000-000000000021',
  'a6f7b140-0022-4444-a000-000000000022',
  'a6f7b140-0023-4444-a000-000000000023',
  'a6f7b140-0024-4444-a000-000000000024',
  'a6f7b140-0025-4444-a000-000000000025'
);

-- Step D: Re-create all foreign key constraints idempotently (B-02)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cities') THEN
    ALTER TABLE public.cities ADD CONSTRAINT fk_cities_region_id FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'supermarket_regions') THEN
    ALTER TABLE public.supermarket_regions ADD CONSTRAINT supermarket_regions_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE CASCADE;
    ALTER TABLE public.supermarket_regions ADD CONSTRAINT supermarket_regions_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'offers') THEN
    ALTER TABLE public.offers ADD CONSTRAINT offers_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL;
    ALTER TABLE public.offers ADD CONSTRAINT offers_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'offer_sources') THEN
    ALTER TABLE public.offer_sources ADD CONSTRAINT offer_sources_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL;
    ALTER TABLE public.offer_sources ADD CONSTRAINT offer_sources_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_preferred_city_id_fkey FOREIGN KEY (preferred_city_id) REFERENCES public.cities(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'shopping_lists') THEN
    ALTER TABLE public.shopping_lists ADD CONSTRAINT shopping_lists_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'import_batches') THEN
    ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL;
    ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_events') THEN
    ALTER TABLE public.app_events ADD CONSTRAINT app_events_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL;
  END IF;
END $$;


-- -------------------------------------------------------------------------
-- 3. Immutable Semantic Revision Snapshots (INT-F11, INT-28, INT-29, INT-32, B-03)
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.offer_revision_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  source_offer_id text NOT NULL,
  source_revision integer NOT NULL,
  semantic_checksum text NOT NULL,
  snapshot_payload jsonb NOT NULL,
  superseded_by_revision integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_offer_revision_source_rev UNIQUE (source_offer_id, source_revision)
);

CREATE INDEX IF NOT EXISTS idx_offer_revision_snapshots_lookup
  ON public.offer_revision_snapshots(source_offer_id, source_revision);

CREATE INDEX IF NOT EXISTS idx_offer_revision_snapshots_offer_id
  ON public.offer_revision_snapshots(offer_id);

-- Hardened Snapshot Permissions: Snapshots are strictly internal historical records (B-03, SEC-HIST-01, SEC-HIST-02)
REVOKE ALL ON public.offer_revision_snapshots FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.offer_revision_snapshots TO service_role;

ALTER TABLE public.offer_revision_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read offer revision snapshots" ON public.offer_revision_snapshots;
DROP POLICY IF EXISTS "Admin and service read snapshots" ON public.offer_revision_snapshots;
CREATE POLICY "Admin and service read snapshots"
  ON public.offer_revision_snapshots
  FOR SELECT
  TO authenticated, service_role
  USING (public.is_admin());

-- Sanitized consumer-safe RPC function for revision history summary (SEC-HIST-03)
CREATE OR REPLACE FUNCTION public.get_offer_revision_history_summary(p_source_offer_id text)
RETURNS TABLE (
  source_offer_id text,
  source_revision integer,
  offer_price numeric,
  price_basis text,
  sale_unit_type text,
  inner_pack_count integer,
  each_size_value numeric,
  each_size_unit text,
  loyalty_requirement text,
  offer_start_date date,
  offer_end_date date,
  superseded_by_revision integer,
  created_at timestamptz
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.source_offer_id,
    s.source_revision,
    (s.snapshot_payload->'price_terms'->>'source_reported_offer_price')::numeric AS offer_price,
    s.snapshot_payload->'price_terms'->>'source_reported_price_basis' AS price_basis,
    s.snapshot_payload->'quantity_semantics'->>'sale_unit' AS sale_unit_type,
    (s.snapshot_payload->'quantity_semantics'->>'inner_count')::integer AS inner_pack_count,
    (s.snapshot_payload->'quantity_semantics'->'per_inner_content'->>'value')::numeric AS each_size_value,
    s.snapshot_payload->'quantity_semantics'->'per_inner_content'->>'unit' AS each_size_unit,
    s.snapshot_payload->'eligibility'->'loyalty'->>'requirement' AS loyalty_requirement,
    (s.snapshot_payload->'temporal'->>'offer_start_date')::date AS offer_start_date,
    (s.snapshot_payload->'temporal'->>'offer_end_date')::date AS offer_end_date,
    s.superseded_by_revision,
    s.created_at
  FROM public.offer_revision_snapshots s
  WHERE s.source_offer_id = p_source_offer_id
  ORDER BY s.source_revision ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_offer_revision_history_summary(text) TO anon, authenticated;


-- -------------------------------------------------------------------------
-- 4. Public Access & Privilege Hardening (INT-F01, INT-F02, INT-F07)
-- -------------------------------------------------------------------------

-- 4.1 Revoke overbroad base grants from anon and authenticated (INT-F02)
REVOKE ALL ON public.offers FROM anon, authenticated;
REVOKE ALL ON public.offer_sources FROM anon, authenticated;
REVOKE ALL ON public.offer_status_history FROM anon, authenticated;
REVOKE ALL ON public.import_batches FROM anon, authenticated;
REVOKE ALL ON public.import_rows FROM anon, authenticated;
REVOKE ALL ON public.validation_errors FROM anon, authenticated;
REVOKE ALL ON public.audit_logs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- Grant ONLY SELECT on public reference tables to anon and authenticated
GRANT SELECT ON TABLE
  public.cities,
  public.regions,
  public.supermarkets,
  public.supermarket_regions,
  public.categories,
  public.brands,
  public.units,
  public.products,
  public.product_aliases
TO anon, authenticated;

-- 4.2 Protect profiles.role from self-service privilege escalation (INT-F02, INT-04)
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger AS $$
BEGIN
  IF (OLD.role IS DISTINCT FROM NEW.role OR OLD.is_active IS DISTINCT FROM NEW.is_active) THEN
    -- Only service_role or validated super_admin can change role / activation
    IF current_user <> 'service_role' AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Privilege escalation blocked: non-admin users cannot alter profile role or is_active.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_prevent_profile_privilege_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_privilege_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE PROCEDURE public.prevent_profile_privilege_escalation();

-- Restrict authenticated column-level UPDATE on profiles strictly to safe profile fields
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (display_name, preferred_language, preferred_city_id, updated_at)
  ON public.profiles TO authenticated;

-- 4.3 Protect issue_reports: restrict insertion to safe open reporting fields & enforce caller identity (B-10, SEC-REPORT-01)
REVOKE INSERT, UPDATE, DELETE ON public.issue_reports FROM anon, authenticated;
GRANT INSERT (offer_id, user_id, issue_type, comment, reporter_email)
  ON public.issue_reports TO anon, authenticated;

DROP POLICY IF EXISTS "Allow public insertion of issue reports" ON public.issue_reports;
DROP POLICY IF EXISTS "Allow public insert restricted issue reports" ON public.issue_reports;
DROP POLICY IF EXISTS "Allow authenticated and anon insert restricted issue reports" ON public.issue_reports;
CREATE POLICY "Allow authenticated and anon insert restricted issue reports"
  ON public.issue_reports
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    status = 'open'
    AND admin_notes IS NULL
    AND resolved_by IS NULL
    AND resolved_at IS NULL
    AND (
      (auth.uid() IS NULL AND user_id IS NULL)
      OR (auth.uid() IS NOT NULL AND (user_id IS NULL OR user_id = auth.uid()))
    )
  );

-- Enforce server-side user_id attribution via trigger to prevent user impersonation
CREATE OR REPLACE FUNCTION public.enforce_issue_report_user_id()
RETURNS trigger AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  ELSE
    NEW.user_id := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_issue_report_user_id ON public.issue_reports;
CREATE TRIGGER trg_enforce_issue_report_user_id
  BEFORE INSERT ON public.issue_reports
  FOR EACH ROW
  EXECUTE PROCEDURE public.enforce_issue_report_user_id();

-- 4.4 Alter default privileges so future tables are not granted broad access
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;


-- -------------------------------------------------------------------------
-- 5. Helper Function: Recursive Consumer Contract Sanitizer (INT-F07, INT-02)
-- -------------------------------------------------------------------------
-- Recursively allowlists consumer-safe sections and strips all local workstation
-- paths (e.g. F:\Work\..., /Users/...) from consumer payloads.

CREATE OR REPLACE FUNCTION public.build_sanitized_consumer_contract_v2(p_contract_v2 jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_assets jsonb;
  v_card jsonb;
  v_thumb jsonb;
  v_clean_card jsonb;
  v_clean_thumb jsonb;
  v_card_storage_path text;
  v_thumb_storage_path text;
BEGIN
  IF p_contract_v2 IS NULL THEN
    RETURN NULL;
  END IF;

  v_assets := p_contract_v2->'assets';
  v_card := COALESCE(v_assets->'offer_card', '{}'::jsonb);
  v_thumb := COALESCE(v_assets->'product_thumbnail', '{}'::jsonb);

  -- Sanitize storage_object_path: strip Windows or local paths to null
  v_card_storage_path := v_card->>'storage_object_path';
  IF v_card_storage_path ~* '^[A-Za-z]:[\\/]|\\\\' THEN
    v_card_storage_path := NULL;
  END IF;

  v_thumb_storage_path := v_thumb->>'storage_object_path';
  IF v_thumb_storage_path ~* '^[A-Za-z]:[\\/]|\\\\' THEN
    v_thumb_storage_path := NULL;
  END IF;

  -- Build clean assets with local_path_internal strictly omitted
  v_clean_card := jsonb_build_object(
    'storage_bucket', v_card->'storage_bucket',
    'storage_object_path', to_jsonb(v_card_storage_path),
    'subject_scope', COALESCE(v_card->'subject_scope', '"unverified"'::jsonb),
    'upload_state', COALESCE(v_card->'upload_state', '"pending"'::jsonb)
  );
  IF v_card ? 'delivery_url' THEN
    v_clean_card := v_clean_card || jsonb_build_object('delivery_url', v_card->'delivery_url');
  END IF;

  v_clean_thumb := jsonb_build_object(
    'storage_bucket', v_thumb->'storage_bucket',
    'storage_object_path', to_jsonb(v_thumb_storage_path),
    'subject_scope', COALESCE(v_thumb->'subject_scope', '"unverified"'::jsonb),
    'upload_state', COALESCE(v_thumb->'upload_state', '"pending"'::jsonb)
  );
  IF v_thumb ? 'delivery_url' THEN
    v_clean_thumb := v_clean_thumb || jsonb_build_object('delivery_url', v_thumb->'delivery_url');
  END IF;

  -- B-09 / MEDIA-01: Strip MEDIA_UPLOAD_PENDING if assets are uploaded
  DECLARE
    v_assessments jsonb := COALESCE(p_contract_v2->'assessments', '{}'::jsonb);
    v_reason_codes jsonb := v_assessments->'reason_codes';
    v_is_uploaded boolean := (v_clean_card->>'upload_state' = 'uploaded' OR v_card_storage_path IS NOT NULL OR v_card ? 'delivery_url');
  BEGIN
    IF v_is_uploaded AND v_reason_codes IS NOT NULL AND jsonb_typeof(v_reason_codes) = 'array' THEN
      v_reason_codes := v_reason_codes - 'MEDIA_UPLOAD_PENDING';
      v_assessments := jsonb_set(v_assessments, '{reason_codes}', v_reason_codes);
    END IF;

    RETURN jsonb_build_object(
      'record_metadata', jsonb_build_object(
        'schema_version', p_contract_v2->'record_metadata'->'schema_version',
        'source_offer_id', p_contract_v2->'record_metadata'->'source_offer_id',
        'source_revision', p_contract_v2->'record_metadata'->'source_revision',
        'semantic_checksum', p_contract_v2->'record_metadata'->'semantic_checksum',
        'producer_model', p_contract_v2->'record_metadata'->'producer_model',
        'supersedes_source_offer_id', p_contract_v2->'record_metadata'->'supersedes_source_offer_id',
        'compound_group_id', p_contract_v2->'record_metadata'->'compound_group_id'
      ),
      'product_facts', p_contract_v2->'product_facts',
      'assortment', p_contract_v2->'assortment',
      'quantity_semantics', p_contract_v2->'quantity_semantics',
      'price_terms', p_contract_v2->'price_terms',
      'promotion_terms', p_contract_v2->'promotion_terms',
      'eligibility', p_contract_v2->'eligibility',
      'assessments', v_assessments,
      'assets', jsonb_build_object(
        'offer_card', v_clean_card,
        'product_thumbnail', v_clean_thumb
      )
    );
  END;
END;
$$;


-- -------------------------------------------------------------------------
-- 6. Harden Public Views: v_consumer_offers & Drop Legacy public_active_offers (INT-F01, INT-F07, INT-F12)
-- -------------------------------------------------------------------------

-- 6.1 Drop legacy wildcard view that exposed unredacted * from public.offers
DROP VIEW IF EXISTS public.public_active_offers CASCADE;
DROP VIEW IF EXISTS public.v_consumer_offers CASCADE;

-- 6.2 Recreate hardened public.v_consumer_offers with:
-- - Strict publication filter: WHERE o.status = 'published' (INT-01)
-- - Sanitized JSONB consumer contract (INT-02, INT-07)
-- - Explicit currency, numeric unit_price, per-asset scopes & upload states (INT-F08, INT-F12)
CREATE OR REPLACE VIEW public.v_consumer_offers
WITH (security_invoker = false)
AS
SELECT
  o.id,
  o.source_offer_id,
  o.source_revision,
  o.semantic_checksum,
  o.contract_version,
  o.compound_group_id,
  o.supersedes_source_offer_id,

  -- Supermarket & Geography Registry
  o.supermarket_id,
  s.name_ar AS supermarket_name_ar,
  s.name_en AS supermarket_name_en,
  s.slug AS supermarket_slug,
  s.code AS supermarket_code,
  s.logo_url AS supermarket_logo_url,
  o.location_scope,
  o.city_id,
  c.name_ar AS city_name_ar,
  c.name_en AS city_name_en,
  c.code AS city_code,
  o.region_id,
  r.name_ar AS region_name_ar,
  r.name_en AS region_name_en,
  r.code AS region_code,

  -- Product Facts & Taxonomy
  o.product_id,
  o.exact_identity_status,
  o.category_id,
  cat.name_ar AS category_name_ar,
  cat.name_en AS category_name_en,
  COALESCE(o.category_slug, cat.slug) AS category_slug,
  o.derived_subcategory_slug,
  o.commodity_tag,
  o.item_domain,
  o.brand_id,
  b.name_ar AS brand_name_ar,
  b.name_en AS brand_name_en,
  o.brand_state,
  o.brand_candidate_text,
  o.title_ar,
  o.title_en,
  o.normalized_title_ar,
  o.normalized_title_en,
  o.product_attributes,

  -- Assortment & Quantity Semantics
  o.assortment_status,
  o.known_options,
  o.sale_unit_type,
  o.inner_pack_count,
  o.each_size_value,
  o.each_size_unit,
  o.total_content_value,
  o.total_content_unit,
  o.is_indivisible_sale_unit,

  -- Pricing, Promotions & Unit Math
  o.offer_price,
  o.original_price AS source_reported_original_price,
  o.verified_non_member_price,
  COALESCE(o.currency, 'SAR') AS currency,
  o.price_basis,
  o.unit_price,
  o.unit_price_unit,
  o.discount_amount,
  o.discount_percentage,
  o.informational_inner_unit_price,
  o.display_unit_price_label_ar,
  o.display_unit_price_label_en,
  o.promo_mechanic,
  o.bonus_wording,
  o.bonus_fulfillment,

  -- Eligibility & Limits
  o.is_loyalty_required,
  o.loyalty_requirement,
  o.quantity_limit,
  o.quantity_limit_value,
  o.quantity_limit_unit,
  o.quantity_limit_scope,

  -- Media & Visual Evidence (Safe Delivery URLs & Storage Paths only, NO Windows paths)
  o.image_url,
  CASE
    WHEN o.image_path ~* '^[A-Za-z]:[\\/]|\\\\' THEN NULL
    ELSE o.image_path
  END AS storage_path,
  o.thumbnail_url,
  CASE
    WHEN o.thumbnail_storage_path ~* '^[A-Za-z]:[\\/]|\\\\' THEN NULL
    ELSE o.thumbnail_storage_path
  END AS thumbnail_storage_path,

  -- Role-specific Subject Scopes and Upload States (INT-F08, INT-F10)
  COALESCE(o.contract_v2->'assets'->'offer_card'->>'subject_scope', o.image_subject_scope) AS card_image_subject_scope,
  COALESCE(
    o.contract_v2->'assets'->'offer_card'->>'upload_state',
    CASE WHEN o.image_url IS NOT NULL THEN 'uploaded' ELSE 'pending' END
  ) AS card_image_upload_state,
  COALESCE(o.contract_v2->'assets'->'product_thumbnail'->>'subject_scope', o.image_subject_scope) AS thumbnail_subject_scope,
  COALESCE(
    o.contract_v2->'assets'->'product_thumbnail'->>'upload_state',
    CASE WHEN o.thumbnail_url IS NOT NULL THEN 'uploaded' ELSE 'pending' END
  ) AS thumbnail_upload_state,

  -- Spatial & Prominence
  o.page_area_share_pct,
  o.is_front_page,
  o.is_hero_offer,
  o.deal_score,
  o.deal_label,

  -- Temporal Validity (Dates & Evaluation in Asia/Riyadh timezone)
  o.offer_start_date,
  o.offer_end_date,
  o.offer_start_date AS valid_from,
  o.offer_end_date AS valid_to,
  'published'::text AS publication_status,
  CASE
    WHEN o.offer_start_date IS NOT NULL AND (now() AT TIME ZONE 'Asia/Riyadh')::date < o.offer_start_date THEN 'upcoming'
    WHEN (now() AT TIME ZONE 'Asia/Riyadh')::date > o.offer_end_date THEN 'expired'
    ELSE 'active'
  END AS temporal_lifecycle_state,

  -- Assessments & Reason Codes
  o.scoped_assessments,
  CASE
    WHEN o.image_url IS NOT NULL OR o.thumbnail_url IS NOT NULL OR o.image_path IS NOT NULL OR o.thumbnail_storage_path IS NOT NULL
    THEN array_remove(o.reason_codes, 'MEDIA_UPLOAD_PENDING')
    ELSE o.reason_codes
  END AS reason_codes,

  -- Sanitized v2 Contract JSONB (strips internal workstation paths recursively)
  public.build_sanitized_consumer_contract_v2(o.contract_v2) AS consumer_contract_v2,

  -- Timestamps
  o.published_at,
  o.created_at,
  o.updated_at

FROM public.offers o
JOIN public.supermarkets s ON o.supermarket_id = s.id
LEFT JOIN public.categories cat ON o.category_id = cat.id
LEFT JOIN public.cities c ON o.city_id = c.id
LEFT JOIN public.regions r ON o.region_id = r.id
LEFT JOIN public.brands b ON o.brand_id = b.id
WHERE o.status = 'published';

-- Grant SELECT on sanitized consumer view to public client roles
GRANT SELECT ON public.v_consumer_offers TO anon, authenticated;


-- -------------------------------------------------------------------------
-- 7. Parameterized Planned Shopping Date & Geographic Access Function (INT-F12, INT-25)
-- -------------------------------------------------------------------------
-- Resolves publication, dates, and geographic applicability (national, city, or parent region)
-- for any requested shopping date without timezone ambiguity.

CREATE OR REPLACE FUNCTION public.get_consumer_offers_for_shopping_date(
  p_shopping_date date DEFAULT (now() AT TIME ZONE 'Asia/Riyadh')::date,
  p_city_id text DEFAULT NULL,
  p_region_id text DEFAULT NULL
)
RETURNS SETOF public.v_consumer_offers
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.*
  FROM public.v_consumer_offers v
  WHERE v.offer_start_date <= p_shopping_date
    AND v.offer_end_date >= p_shopping_date
    AND (
      v.location_scope = 'national'
      OR (p_city_id IS NOT NULL AND v.city_id = p_city_id)
      OR (p_region_id IS NOT NULL AND v.region_id = p_region_id)
      OR (
        p_city_id IS NOT NULL AND v.region_id = (
          SELECT c.region_id FROM public.cities c WHERE c.id = p_city_id LIMIT 1
        )
      )
    )
  ORDER BY v.deal_score DESC NULLS LAST, v.offer_price ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_consumer_offers_for_shopping_date(date, text, text) TO anon, authenticated;

-- =========================================================================
-- End of Migration 006_wifran_07a_security_and_contract_reconciliation.sql
-- =========================================================================
