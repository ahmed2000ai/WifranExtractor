-- =========================================================================
-- Wifran Migration: 003_offer_location_scope.sql
-- Description: Add location_scope to offers and related imports to support National, Region, and City level coverage.
-- =========================================================================

-- 1. Remove old constraints that force geography
ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS chk_offer_geography;

-- 2. Add location_scope to offers
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'location_scope') THEN
        ALTER TABLE public.offers ADD COLUMN location_scope text;
    END IF;
END $$;

-- 3. Backfill existing offers safely
UPDATE public.offers
SET location_scope = 'city'
WHERE location_scope IS NULL AND city_id IS NOT NULL;

UPDATE public.offers
SET location_scope = 'region'
WHERE location_scope IS NULL AND region_id IS NOT NULL AND city_id IS NULL;

UPDATE public.offers
SET location_scope = 'national'
WHERE location_scope IS NULL;

-- 4. Make location_scope required and add constraint
ALTER TABLE public.offers ALTER COLUMN location_scope SET NOT NULL;

ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS chk_offer_location_scope;
ALTER TABLE public.offers ADD CONSTRAINT chk_offer_location_scope 
CHECK (location_scope IN ('national', 'region', 'city'));

ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS chk_offer_location_scope_rules;
ALTER TABLE public.offers ADD CONSTRAINT chk_offer_location_scope_rules 
CHECK (
  (location_scope = 'national' AND city_id IS NULL AND region_id IS NULL) OR
  (location_scope = 'region' AND region_id IS NOT NULL AND city_id IS NULL) OR
  (location_scope = 'city' AND city_id IS NOT NULL)
);

-- 5. Add location_scope to import_batches
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_batches' AND column_name = 'location_scope') THEN
        ALTER TABLE public.import_batches ADD COLUMN location_scope text;
    END IF;
END $$;

UPDATE public.import_batches
SET location_scope = 'city'
WHERE location_scope IS NULL AND city_id IS NOT NULL;

UPDATE public.import_batches
SET location_scope = 'region'
WHERE location_scope IS NULL AND region_id IS NOT NULL AND city_id IS NULL;

UPDATE public.import_batches
SET location_scope = 'national'
WHERE location_scope IS NULL;

-- If import_batches has active rows, might as well make it NOT NULL later, but let's allow NULL if it's not strictly required in the schema currently. We will add check constraint though.
ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS chk_import_batch_location_scope;
ALTER TABLE public.import_batches ADD CONSTRAINT chk_import_batch_location_scope 
CHECK (location_scope IN ('national', 'region', 'city') OR location_scope IS NULL);

-- 6. Add Indexes
create index if not exists idx_offers_location_scope on public.offers(location_scope);

-- Re-create public active location index (with 'if not exists', we can safely drop/recreate if we want but Postgres syntax for that is tricky. Just create a new one).
create index if not exists idx_offers_public_location_active
  on public.offers(status, offer_end_date, location_scope, city_id, region_id);
