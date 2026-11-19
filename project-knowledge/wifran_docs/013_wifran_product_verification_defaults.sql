-- ============================================================================
-- Migration 013: Product Verification Defaults & Positive Quantity Constraints
-- ============================================================================
-- Purpose:
--   1. Harden public.products verification defaults:
--      - verification_status: DEFAULT 'candidate' (was 'verified')
--      - verification_basis: DEFAULT 'auto_extraction_provisional' (was 'operator_verified_pack_identity')
--      Prevents provisional or newly inserted products from silently defaulting to verified.
--   2. Add defensive check constraints to public.products to enforce positive quantities:
--      - each_size_value > 0 (when not null)
--      - inner_pack_count > 0 (when not null)
--   3. Completely backward-compatible and safe on existing rows.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- 1. Alter defaults on public.products
ALTER TABLE public.products
  ALTER COLUMN verification_status SET DEFAULT 'candidate'::text,
  ALTER COLUMN verification_basis SET DEFAULT 'auto_extraction_provisional'::text;

-- 2. Add validation check constraints if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_positive_size'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT chk_products_positive_size
      CHECK (each_size_value IS NULL OR each_size_value > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_positive_inner_count'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT chk_products_positive_inner_count
      CHECK (inner_pack_count IS NULL OR inner_pack_count > 0);
  END IF;
END $$;

-- 3. Harden offers contract_version default
ALTER TABLE public.offers
  ALTER COLUMN contract_version SET DEFAULT 'wifran.extractor.offer/2.0'::text;

COMMIT;
