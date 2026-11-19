-- ============================================================================
-- Migration 013 ROLLBACK: Restore Original Product Defaults
-- ============================================================================
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.products
  ALTER COLUMN verification_status SET DEFAULT 'verified'::text,
  ALTER COLUMN verification_basis SET DEFAULT 'operator_verified_pack_identity'::text;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS chk_products_positive_size;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS chk_products_positive_inner_count;

ALTER TABLE public.offers
  ALTER COLUMN contract_version SET DEFAULT '2.0'::text;

COMMIT;
