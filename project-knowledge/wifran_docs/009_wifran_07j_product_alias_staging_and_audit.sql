-- =========================================================================
-- Migration 009: WIFRAN-07J Product Alias Staging & Audit Trail
-- File: project-knowledge/wifran_docs/009_wifran_07j_product_alias_staging_and_audit.sql
--
-- STATUS: PROPOSED ADDITIVE MIGRATION (OFFLINE SPECIFICATION ONLY)
-- NOTE: DO NOT EXECUTE ON PRODUCTION OR LIVE SUPABASE UNTIL SERVER-SIDE
--       OPERATOR AUTHENTICATION INFRASTRUCTURE HAS BEEN DEPLOYED.
--
-- Objective:
-- Introduce secure staging and tamper-evident audit logging for candidate
-- product aliases (Milestone 2E), isolating unvetted aliases from the
-- active catalog until authenticated operator review and approval.
--
-- Key Safety & Architecture Invariants:
-- 1. ADDITIVE ONLY: Zero modifications or drops of existing tables.
-- 2. ZERO CONSUMER IMPACT: v_consumer_offers and RPC contracts are untouched.
-- 3. PROPOSAL ISOLATION: Candidate aliases live in product_alias_proposals,
--    never in public.product_aliases until atomic approval.
-- 4. DETERMINISTIC UNIQUENESS & NORMALIZATION: Canonical normalized key is
--    computed via public.normalize_alias_key(alias_text).
-- 5. IMMUTABLE AUDIT LOG: Append-only audit table with no UPDATE or DELETE grants.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. Product Alias Proposals Table (Staging Area)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_alias_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_text text NOT NULL,
  canonical_normalized_key text GENERATED ALWAYS AS (public.normalize_alias_key(alias_text)) STORED,
  proposed_product_id bigint NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  language text NOT NULL DEFAULT 'unknown' CHECK (language IN ('ar', 'en', 'mixed', 'unknown')),
  source_offer_id text,
  evidence jsonb DEFAULT '{}'::jsonb,
  compatibility_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposal_origin text NOT NULL DEFAULT 'operator' CHECK (proposal_origin IN ('operator', 'extraction_suggestion', 'system')),
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected', 'conflict_needs_review', 'superseded')),
  proposing_operator_id text NOT NULL,
  reviewing_operator_id text,
  review_decision text CHECK (review_decision IN ('approved', 'rejected', 'conflict_flagged')),
  review_reason text,
  identity_evidence_hash text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_at timestamptz,
  CONSTRAINT chk_alias_text_not_empty CHECK (length(trim(alias_text)) > 0)
);

-- Indexes for efficient proposal lookup and conflict detection
CREATE INDEX IF NOT EXISTS idx_product_alias_proposals_status
  ON public.product_alias_proposals (status);

CREATE INDEX IF NOT EXISTS idx_product_alias_proposals_product_id
  ON public.product_alias_proposals (proposed_product_id);

CREATE INDEX IF NOT EXISTS idx_product_alias_proposals_normalized_key
  ON public.product_alias_proposals (canonical_normalized_key);

-- -------------------------------------------------------------------------
-- 2. Product Alias Audit Log (Tamper-Evident History)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_alias_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.product_alias_proposals(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('proposed', 'reviewed', 'approved', 'rejected', 'conflict_flagged', 'superseded', 'revalidated')),
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  previous_status text,
  new_status text NOT NULL,
  reason text,
  signature_verified boolean NOT NULL DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_product_alias_audit_proposal
  ON public.product_alias_audit_log (proposal_id, created_at);

-- -------------------------------------------------------------------------
-- 3. Row-Level Security (RLS) & Access Control
-- -------------------------------------------------------------------------
ALTER TABLE public.product_alias_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_alias_audit_log ENABLE ROW LEVEL SECURITY;

-- Read policies: Authorized operators and service_role can view proposals and audit logs
CREATE POLICY "Allow operators to view alias proposals"
  ON public.product_alias_proposals
  FOR SELECT
  TO authenticated, service_role
  USING (true);

CREATE POLICY "Allow operators to insert alias proposals"
  ON public.product_alias_proposals
  FOR INSERT
  TO authenticated, service_role
  WITH CHECK (true);

-- Direct UPDATE: Operators can only update proposals that are in non-terminal states.
-- They CANNOT directly set status to 'approved'. Approval MUST go through approve_product_alias_atomic.
CREATE POLICY "Allow operators to update non-approved alias proposals"
  ON public.product_alias_proposals
  FOR UPDATE
  TO authenticated, service_role
  USING (status IN ('pending_review', 'conflict_needs_review'))
  WITH CHECK (status <> 'approved');

CREATE POLICY "Allow operators to view alias audit log"
  ON public.product_alias_audit_log
  FOR SELECT
  TO authenticated, service_role
  USING (true);

-- APPEND-ONLY AUDIT LOG: Only INSERT is allowed for application roles. UPDATE and DELETE are prohibited.
-- NOTE: Grant revocation protects against application roles (anon, authenticated).
-- Database superusers (postgres) retain administrative access per PostgreSQL architecture.
CREATE POLICY "Allow append-only insert to alias audit log"
  ON public.product_alias_audit_log
  FOR INSERT
  TO authenticated, service_role
  WITH CHECK (true);

-- Explicitly revoke UPDATE and DELETE on audit log for all non-admin roles
REVOKE UPDATE, DELETE ON TABLE public.product_alias_audit_log FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 4. Atomic Approval Transaction Function
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_product_alias_atomic(
  p_proposal_id uuid,
  p_reviewer_id text,
  p_reviewer_role text,
  p_reason text,
  p_signature_verified boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_proposal record;
  v_product record;
  v_existing_alias record;
  v_now timestamptz := clock_timestamp();
BEGIN
  -- 1. Authorization check: signature verification and role required
  IF NOT p_signature_verified THEN
    RAISE EXCEPTION 'AUTHORIZATION_FAILED: Cryptographic server signature verification is required.';
  END IF;

  IF p_reviewer_role NOT IN ('catalog_admin', 'catalog_operator') THEN
    RAISE EXCEPTION 'AUTHORIZATION_FAILED: Role % is not authorized to approve aliases.', p_reviewer_role;
  END IF;

  -- 2. Lock proposal row for update
  SELECT * INTO v_proposal
  FROM public.product_alias_proposals
  WHERE id = p_proposal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_FOUND: Proposal ID % does not exist.', p_proposal_id;
  END IF;

  IF v_proposal.status NOT IN ('pending_review', 'conflict_needs_review') THEN
    RAISE EXCEPTION 'INVALID_PROPOSAL_STATE: Proposal is already in % state.', v_proposal.status;
  END IF;

  -- 3. Verify target product still exists and is verified
  SELECT * INTO v_product
  FROM public.products
  WHERE id = v_proposal.proposed_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TARGET_PRODUCT_NOT_FOUND: Product ID % does not exist.', v_proposal.proposed_product_id;
  END IF;

  IF v_product.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'TARGET_PRODUCT_NOT_VERIFIED: Product ID % is % (must be verified).',
      v_proposal.proposed_product_id, v_product.verification_status;
  END IF;

  -- 4. Conflict check against existing active aliases in product_aliases
  SELECT * INTO v_existing_alias
  FROM public.product_aliases
  WHERE public.normalize_alias_key(alias_text) = v_proposal.canonical_normalized_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_alias.product_id = v_proposal.proposed_product_id THEN
      RAISE EXCEPTION 'DUPLICATE_SAME_PRODUCT_ALIAS: Normalized key already exists for this product.';
    ELSE
      RAISE EXCEPTION 'CROSS_PRODUCT_ALIAS_CONFLICT: Normalized key conflicts with product ID %.', v_existing_alias.product_id;
    END IF;
  END IF;

  -- 5. Insert into active product_aliases
  INSERT INTO public.product_aliases (
    product_id,
    alias_text,
    language,
    source
  ) VALUES (
    v_proposal.proposed_product_id,
    v_proposal.alias_text,
    v_proposal.language,
    'approved_proposal:' || p_proposal_id::text
  );

  -- 6. Update proposal status
  UPDATE public.product_alias_proposals
  SET
    status = 'approved',
    reviewing_operator_id = p_reviewer_id,
    review_decision = 'approved',
    review_reason = p_reason,
    reviewed_at = v_now,
    updated_at = v_now
  WHERE id = p_proposal_id;

  -- 7. Append immutable audit log entry
  INSERT INTO public.product_alias_audit_log (
    proposal_id,
    action,
    actor_id,
    actor_role,
    previous_status,
    new_status,
    reason,
    signature_verified,
    metadata
  ) VALUES (
    p_proposal_id,
    'approved',
    p_reviewer_id,
    p_reviewer_role,
    v_proposal.status,
    'approved',
    p_reason,
    true,
    jsonb_build_object('canonical_normalized_key', v_proposal.canonical_normalized_key)
  );

  RETURN jsonb_build_object(
    'success', true,
    'proposal_id', p_proposal_id,
    'status', 'approved',
    'approved_at', v_now
  );
END;
$$;

-- Revoke default public execution privileges and grant least privilege
REVOKE ALL ON FUNCTION public.approve_product_alias_atomic(uuid, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_product_alias_atomic(uuid, text, text, text, boolean) TO authenticated, service_role;

COMMIT;

-- -------------------------------------------------------------------------
-- 5. Rollback Script (for staging environment reference only)
-- -------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.approve_product_alias_atomic(uuid, text, text, text, boolean);
-- DROP TABLE IF EXISTS public.product_alias_audit_log;
-- DROP TABLE IF EXISTS public.product_alias_proposals;

