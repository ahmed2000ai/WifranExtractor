-- ============================================================================
-- Wifran Migration 010: Publication Journal, Uniqueness, Idempotency & Undo
-- Milestone: WIFRAN-EXTRACTOR-IDENTITY-005J-UAT-FIX-08
-- Requirements: MIG-01..04, DB-01..03, JOURNAL-01..05, STORAGE-01..04, REV-01..14
-- Additive & Idempotent — Safe for Isolated Verification & Controlled Rollout
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Additive Source Provenance Columns & Uniqueness Guards on public.offers
-- ---------------------------------------------------------------------------
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS source_document_id text,
  ADD COLUMN IF NOT EXISTS source_pdf_sha256 text,
  ADD COLUMN IF NOT EXISTS source_page_hash text,
  ADD COLUMN IF NOT EXISTS source_offer_anchor text,
  ADD COLUMN IF NOT EXISTS last_publish_operation_id uuid;

-- Enforce database-level source_offer_id uniqueness if no unique index exists yet
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'offers'
      AND indexdef ILIKE '%UNIQUE%source_offer_id%'
  ) THEN
    CREATE UNIQUE INDEX idx_offers_source_offer_id
      ON public.offers (source_offer_id)
      WHERE source_offer_id IS NOT NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_offers_source_document_id
  ON public.offers (source_document_id)
  WHERE source_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offers_secondary_dedup
  ON public.offers (supermarket_id, product_id, offer_start_date, offer_end_date)
  WHERE status IN ('published', 'approved');

-- ---------------------------------------------------------------------------
-- 2. Durable Publication Operations Ledger (JOURNAL-01, JOURNAL-05, REV-01..14)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.publication_operations (
  publish_operation_id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  payload_fingerprint text NOT NULL,
  target_project_ref text NOT NULL,
  environment_context text NOT NULL
    CHECK (environment_context IN ('PRODUCTION_UI', 'DEVELOPMENT_TEST', 'ISOLATED_TEST')),
  batch_id text NOT NULL,
  source_document_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  operator_id text NOT NULL,
  status text NOT NULL
    CHECK (
      status IN (
        'in_progress',
        'completed',
        'noop',
        'failed',
        'undo_in_progress',
        'undo_blocked',
        'undo_cleanup_pending',
        'undone',
        'undo_failed'
      )
    ),
  requested_offers_count integer NOT NULL DEFAULT 0,
  inserted_offers_count integer NOT NULL DEFAULT 0,
  updated_offers_count integer NOT NULL DEFAULT 0,
  unchanged_noop_count integer NOT NULL DEFAULT 0,
  skipped_duplicates_count integer NOT NULL DEFAULT 0,
  conflicts_count integer NOT NULL DEFAULT 0,
  created_products_count integer NOT NULL DEFAULT 0,
  reused_products_count integer NOT NULL DEFAULT 0,
  storage_objects_uploaded integer NOT NULL DEFAULT 0,
  storage_objects_reused integer NOT NULL DEFAULT 0,
  storage_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  preflight_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  undo_eligible boolean NOT NULL DEFAULT false,
  undo_target_operation_id uuid,
  undone_by_operation_id uuid,
  undo_requested_by text,
  undo_reason text,
  undo_blocked_reason text,
  error_diagnostics jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  undone_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_publication_operations_status_completed
  ON public.publication_operations (status, undo_eligible, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_publication_operations_batch_id
  ON public.publication_operations (batch_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Row-Level Pre/Post Mutation Journal (JOURNAL-02, JOURNAL-03, REV-04..09)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.publication_journal_mutations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publish_operation_id uuid NOT NULL
    REFERENCES public.publication_operations(publish_operation_id) ON DELETE CASCADE,
  sequence_no integer NOT NULL,
  table_schema text NOT NULL DEFAULT 'public',
  table_name text NOT NULL,
  record_pk text NOT NULL,
  mutation_type text NOT NULL CHECK (mutation_type IN ('insert', 'update', 'delete')),
  capture_source text NOT NULL DEFAULT 'application_tx'
    CHECK (capture_source IN ('application_tx', 'db_trigger')),
  pre_state jsonb,
  post_state jsonb,
  post_state_hash text,
  reused_existing boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (publish_operation_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS idx_pub_journal_mutations_op_seq
  ON public.publication_journal_mutations (publish_operation_id, sequence_no DESC);

CREATE INDEX IF NOT EXISTS idx_pub_journal_mutations_table_pk
  ON public.publication_journal_mutations (table_name, record_pk);

-- ---------------------------------------------------------------------------
-- 4. Duplicate & Skip Audit Table (DUP-02A..E)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.publication_duplicate_skips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publish_operation_id uuid NOT NULL
    REFERENCES public.publication_operations(publish_operation_id) ON DELETE CASCADE,
  batch_offer_key text NOT NULL,
  source_offer_id text,
  existing_offer_id uuid,
  classification text NOT NULL
    CHECK (classification IN ('already_published', 'duplicate_conflict', 'skipped_policy')),
  reason text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pub_duplicate_skips_op
  ON public.publication_duplicate_skips (publish_operation_id);

-- ---------------------------------------------------------------------------
-- 5. Staged & Committed Storage Object Lifecycle Table (STORAGE-01..04)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.publication_storage_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publish_operation_id uuid NOT NULL
    REFERENCES public.publication_operations(publish_operation_id) ON DELETE CASCADE,
  bucket text NOT NULL,
  object_path text NOT NULL,
  content_sha256 text,
  ownership_mode text NOT NULL CHECK (ownership_mode IN ('exclusive_created', 'reused_existing')),
  storage_state text NOT NULL
    CHECK (
      storage_state IN (
        'staged',
        'committed',
        'cleanup_pending',
        'cleaned_up',
        'cleanup_skipped_referenced',
        'cleanup_failed'
      )
    ),
  linked_offer_id uuid,
  linked_product_id bigint,
  cleanup_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (publish_operation_id, bucket, object_path)
);

CREATE INDEX IF NOT EXISTS idx_pub_storage_ops_object_state
  ON public.publication_storage_operations (bucket, object_path, storage_state);

-- ---------------------------------------------------------------------------
-- 6. Automatic Indirect Mutation Capture Trigger Helper (JOURNAL-03)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.capture_indirect_publication_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_op_id_text text;
  v_op_id uuid;
  v_suppress text;
  v_seq integer;
  v_pk text;
  v_pre jsonb;
  v_post jsonb;
  v_mut_type text;
BEGIN
  v_suppress := current_setting('wifran.suppress_journal_trigger', true);
  IF v_suppress = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_op_id_text := current_setting('wifran.active_publish_operation_id', true);
  IF v_op_id_text IS NULL OR length(trim(v_op_id_text)) = 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  BEGIN
    v_op_id := v_op_id_text::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN COALESCE(NEW, OLD);
  END;

  IF TG_OP = 'INSERT' THEN
    v_mut_type := 'insert';
    v_pre := NULL;
    v_post := to_jsonb(NEW);
    v_pk := COALESCE(v_post->>'id', '');
  ELSIF TG_OP = 'UPDATE' THEN
    v_mut_type := 'update';
    v_pre := to_jsonb(OLD);
    v_post := to_jsonb(NEW);
    v_pk := COALESCE(v_post->>'id', v_pre->>'id', '');
  ELSE
    v_mut_type := 'delete';
    v_pre := to_jsonb(OLD);
    v_post := NULL;
    v_pk := COALESCE(v_pre->>'id', '');
  END IF;

  IF length(v_pk) = 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(MAX(sequence_no), 0) + 1
  INTO v_seq
  FROM public.publication_journal_mutations
  WHERE publish_operation_id = v_op_id;

  INSERT INTO public.publication_journal_mutations (
    publish_operation_id,
    sequence_no,
    table_schema,
    table_name,
    record_pk,
    mutation_type,
    capture_source,
    pre_state,
    post_state,
    reused_existing,
    metadata
  ) VALUES (
    v_op_id,
    v_seq,
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME,
    v_pk,
    v_mut_type,
    'db_trigger',
    v_pre,
    v_post,
    false,
    jsonb_build_object('trigger_name', TG_NAME)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'offer_status_history'
  ) THEN
    DROP TRIGGER IF EXISTS trg_wifran_journal_offer_status_history ON public.offer_status_history;
    CREATE TRIGGER trg_wifran_journal_offer_status_history
      AFTER INSERT OR UPDATE OR DELETE ON public.offer_status_history
      FOR EACH ROW EXECUTE FUNCTION public.capture_indirect_publication_mutation();
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'offer_revision_snapshots'
  ) THEN
    DROP TRIGGER IF EXISTS trg_wifran_journal_offer_revision_snapshots ON public.offer_revision_snapshots;
    CREATE TRIGGER trg_wifran_journal_offer_revision_snapshots
      AFTER INSERT OR UPDATE OR DELETE ON public.offer_revision_snapshots
      FOR EACH ROW EXECUTE FUNCTION public.capture_indirect_publication_mutation();
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 7. Dynamic Schema Readiness Introspection Function (MIG-04, PUB-02)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_wifran_schema_readiness()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'has_migration_009_alias_proposals', EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'product_alias_proposals'
    ),
    'has_migration_009_alias_audit', EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'product_alias_audit_log'
    ),
    'has_migration_009_approve_fn', EXISTS (
      SELECT 1 FROM information_schema.routines
      WHERE routine_schema = 'public' AND routine_name = 'approve_product_alias_atomic'
    ),
    'has_migration_010_pub_ops', EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'publication_operations'
    ),
    'has_migration_010_journal_mutations', EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'publication_journal_mutations'
    ),
    'has_migration_010_duplicate_skips', EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'publication_duplicate_skips'
    ),
    'has_migration_010_storage_ops', EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'publication_storage_operations'
    ),
    'has_consumer_view_v_consumer_offers', EXISTS (
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = 'v_consumer_offers'
    ),
    'has_offers_source_document_col', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'offers' AND column_name = 'source_document_id'
    ),
    'has_offers_source_unique_idx', EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'offers' AND indexdef ILIKE '%UNIQUE%source_offer_id%'
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 8. Security & Least-Privilege Hardening on Publication Journals & RPCs
-- ---------------------------------------------------------------------------
ALTER TABLE public.publication_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_journal_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_duplicate_skips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_storage_operations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.publication_operations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.publication_journal_mutations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.publication_duplicate_skips FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.publication_storage_operations FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.publication_operations TO service_role;
GRANT ALL ON public.publication_journal_mutations TO service_role;
GRANT ALL ON public.publication_duplicate_skips TO service_role;
GRANT ALL ON public.publication_storage_operations TO service_role;

REVOKE ALL ON FUNCTION public.capture_indirect_publication_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_wifran_schema_readiness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_wifran_schema_readiness() TO service_role;

COMMIT;
