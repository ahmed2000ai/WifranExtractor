-- =========================================================================
-- Migration: 004_offer_image_ingestion_metadata.sql
-- Description: Add external tool image ingestion and source fields
-- =========================================================================

-- 1. Add new fields to offers
ALTER TABLE public.offers 
  ADD COLUMN IF NOT EXISTS image_path text,
  ADD COLUMN IF NOT EXISTS image_bucket text DEFAULT 'offer-images',
  ADD COLUMN IF NOT EXISTS image_source_type text,
  ADD COLUMN IF NOT EXISTS source_item_number text,
  ADD COLUMN IF NOT EXISTS external_image_id text,
  ADD COLUMN IF NOT EXISTS ingestion_source text;

-- 2. Add new fields to offer_sources
ALTER TABLE public.offer_sources 
  ADD COLUMN IF NOT EXISTS leaflet_id text,
  ADD COLUMN IF NOT EXISTS storage_prefix text,
  ADD COLUMN IF NOT EXISTS image_count integer;

-- 3. Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_offers_offer_source_id ON public.offers(source_id);
CREATE INDEX IF NOT EXISTS idx_offers_image_path ON public.offers(image_path);
CREATE INDEX IF NOT EXISTS idx_offers_external_image_id ON public.offers(external_image_id);
CREATE INDEX IF NOT EXISTS idx_offer_sources_leaflet_id ON public.offer_sources(leaflet_id);
