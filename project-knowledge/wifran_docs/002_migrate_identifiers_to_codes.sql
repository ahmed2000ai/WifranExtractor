-- =========================================================================
-- DISPOSABLE CLEAN-INIT ONLY (DO NOT RUN ON POPULATED DATABASES) (INT-F03)
-- WARNING: This script contains TRUNCATE TABLE ... CASCADE which destroys all
-- live data! For upgrading populated databases, use:
-- 006_wifran_07a_security_and_contract_reconciliation.sql
-- =========================================================================
-- Migration Script: Convert identifiers to 4-letter codes
-- WARNING: This will drop existing reference data and alter columns to TEXT.

-- 1. Drop foreign key constraints
ALTER TABLE public.supermarket_regions
  DROP CONSTRAINT IF EXISTS supermarket_regions_supermarket_id_fkey,
  DROP CONSTRAINT IF EXISTS supermarket_regions_city_id_fkey,
  DROP CONSTRAINT IF EXISTS supermarket_regions_region_id_fkey;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_preferred_city_id_fkey;

ALTER TABLE public.offer_sources
  DROP CONSTRAINT IF EXISTS offer_sources_supermarket_id_fkey,
  DROP CONSTRAINT IF EXISTS offer_sources_city_id_fkey,
  DROP CONSTRAINT IF EXISTS offer_sources_region_id_fkey;

ALTER TABLE public.offers
  DROP CONSTRAINT IF EXISTS offers_supermarket_id_fkey,
  DROP CONSTRAINT IF EXISTS offers_city_id_fkey,
  DROP CONSTRAINT IF EXISTS offers_region_id_fkey;

ALTER TABLE public.shopping_lists
  DROP CONSTRAINT IF EXISTS shopping_lists_city_id_fkey;

ALTER TABLE public.import_batches
  DROP CONSTRAINT IF EXISTS import_batches_supermarket_id_fkey,
  DROP CONSTRAINT IF EXISTS import_batches_city_id_fkey,
  DROP CONSTRAINT IF EXISTS import_batches_region_id_fkey;

ALTER TABLE public.app_events
  DROP CONSTRAINT IF EXISTS app_events_city_id_fkey;

-- 2. Drop unique index on supermarket_regions
DROP INDEX IF EXISTS public.unique_supermarket_city_region;

-- 3. Delete existing data from these tables to allow type change without mapping issues
TRUNCATE TABLE public.supermarkets CASCADE;
TRUNCATE TABLE public.cities CASCADE;
TRUNCATE TABLE public.regions CASCADE;

-- 4. Alter primary keys to TEXT
ALTER TABLE public.supermarkets ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.supermarkets ALTER COLUMN id TYPE text USING id::text;

ALTER TABLE public.cities ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.cities ALTER COLUMN id TYPE text USING id::text;

ALTER TABLE public.regions ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.regions ALTER COLUMN id TYPE text USING id::text;

-- 5. Alter foreign keys to TEXT
ALTER TABLE public.supermarket_regions 
  ALTER COLUMN supermarket_id TYPE text,
  ALTER COLUMN city_id TYPE text,
  ALTER COLUMN region_id TYPE text;

ALTER TABLE public.profiles ALTER COLUMN preferred_city_id TYPE text;

ALTER TABLE public.offer_sources 
  ALTER COLUMN supermarket_id TYPE text,
  ALTER COLUMN city_id TYPE text,
  ALTER COLUMN region_id TYPE text;

ALTER TABLE public.offers 
  ALTER COLUMN supermarket_id TYPE text,
  ALTER COLUMN city_id TYPE text,
  ALTER COLUMN region_id TYPE text;

ALTER TABLE public.shopping_lists ALTER COLUMN city_id TYPE text;

ALTER TABLE public.import_batches 
  ALTER COLUMN supermarket_id TYPE text,
  ALTER COLUMN city_id TYPE text,
  ALTER COLUMN region_id TYPE text;

ALTER TABLE public.app_events ALTER COLUMN city_id TYPE text;

-- 6. Recreate unique index
CREATE UNIQUE INDEX unique_supermarket_city_region 
  ON public.supermarket_regions (
    supermarket_id, 
    COALESCE(city_id, 'NONE'::text), 
    COALESCE(region_id, 'NONE'::text)
  );

-- 7. Re-add foreign key constraints
ALTER TABLE public.supermarket_regions
  ADD CONSTRAINT supermarket_regions_supermarket_id_fkey FOREIGN KEY (supermarket_id) REFERENCES public.supermarkets(id) ON DELETE CASCADE,
  ADD CONSTRAINT supermarket_regions_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE CASCADE,
  ADD CONSTRAINT supermarket_regions_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE CASCADE;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_city_id_fkey FOREIGN KEY (preferred_city_id) REFERENCES public.cities(id) ON DELETE SET NULL;

ALTER TABLE public.offer_sources
  ADD CONSTRAINT offer_sources_supermarket_id_fkey FOREIGN KEY (supermarket_id) REFERENCES public.supermarkets(id) ON DELETE SET NULL,
  ADD CONSTRAINT offer_sources_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL,
  ADD CONSTRAINT offer_sources_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;

ALTER TABLE public.offers
  ADD CONSTRAINT offers_supermarket_id_fkey FOREIGN KEY (supermarket_id) REFERENCES public.supermarkets(id) ON DELETE CASCADE,
  ADD CONSTRAINT offers_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL,
  ADD CONSTRAINT offers_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;

ALTER TABLE public.shopping_lists
  ADD CONSTRAINT shopping_lists_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL;

ALTER TABLE public.import_batches
  ADD CONSTRAINT import_batches_supermarket_id_fkey FOREIGN KEY (supermarket_id) REFERENCES public.supermarkets(id) ON DELETE SET NULL,
  ADD CONSTRAINT import_batches_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL,
  ADD CONSTRAINT import_batches_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;

ALTER TABLE public.app_events
  ADD CONSTRAINT app_events_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL;
