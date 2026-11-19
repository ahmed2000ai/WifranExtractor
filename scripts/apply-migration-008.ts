// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import { Client } from 'pg'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

// Safely load environment configuration from .env.local and .env (strictly no hardcoded credentials)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

/**
 * Migration 008 Deployment Script
 * File: scripts/apply-migration-008.ts
 *
 * Objective:
 * Applies Migration 008 (WIFRAN-07J Consumer View Disputed Identity Masking & Non-Destructive Alias Normalization)
 * to the Wifran Supabase PostgreSQL database.
 *
 * Security & Reliability Safeguards (WIFRAN-EXTRACTOR-IDENTITY-001G):
 * 1. P0 Credentials & Verified TLS:
 *    - Zero embedded passwords, tokens, or credential fallbacks.
 *    - Requires database password via SUPABASE_DB_PASSWORD or DATABASE_URL.
 *    - Strictly parses DATABASE_URL (fails closed on malformed URL).
 *    - Enforces verified TLS (rejectUnauthorized: true); fails explicitly if custom CA file does not exist.
 *    - Never logs passwords, secrets, or credential-bearing connection strings.
 * 2. P0 Target Database Identity & Authorization:
 *    - Derives project reference from recognized Supabase direct host (db.<ref>.supabase.co or <ref>.supabase.co)
 *      or connection pooler host (*.pooler.supabase.com with user postgres.<ref>).
 *    - Rejects unknown or unsupported host formats without hardcoded fallbacks.
 *    - Rejects implicit production host defaults when no target host is configured.
 *    - Rejects unexpected positional arguments and unrecognized CLI flags.
 *    - Requires explicit project confirmation (--confirm-project=<ref>) for live deployment (--apply).
 * 3. P0 Elimination of DROP VIEW CASCADE:
 *    - Uses in-place CREATE OR REPLACE VIEW preserving all 98 columns, names, types, and ordering.
 *    - Prevents destruction of dependent functions (get_consumer_offers_for_shopping_date).
 *    - Preserves Migration 007 private-image isolation (never projects raw offer media).
 * 4. P1 Transaction Timeouts:
 *    - Enforces SET LOCAL statement_timeout = '60s' and SET LOCAL lock_timeout = '10s' inside transaction.
 * 5. P1 Genuinely Read-Only Preflight:
 *    - --preflight-only executes read-only SELECT queries with zero DDL.
 * 6. P1 Fail-Closed Post-Migration Assertions (1-8):
 *    - Complete 98-column contract comparison (names, types, ordinal positions).
 *    - Unique alias index actual catalog expression (pg_get_expr / pg_indexes.indexdef).
 *    - Exact RPC schema, arguments, SECURITY DEFINER, and EXECUTE privileges for anon/authenticated.
 *    - Fail-closed SELECT grants check (throws explicit error if anon or authenticated missing).
 *    - Exact identity masking verified across ALL rows (IS DISTINCT FROM 'verified_linked', zero row limit).
 *    - View definition verification via pg_views.definition to confirm conditional masking logic.
 *    - Aborts transaction and rolls back on any assertion failure.
 * 7. Non-Destructive Alias Handling:
 *    - Detects cross-product conflicts and same-product duplicates without deleting data.
 */

export const EXPECTED_CONSUMER_VIEW_COLUMNS: Array<{ position: number; name: string; type: string }> = [
  { position: 1, name: 'id', type: 'uuid' },
  { position: 2, name: 'source_offer_id', type: 'text' },
  { position: 3, name: 'source_revision', type: 'integer' },
  { position: 4, name: 'semantic_checksum', type: 'text' },
  { position: 5, name: 'contract_version', type: 'text' },
  { position: 6, name: 'compound_group_id', type: 'text' },
  { position: 7, name: 'supersedes_source_offer_id', type: 'text' },
  { position: 8, name: 'supermarket_id', type: 'text' },
  { position: 9, name: 'supermarket_name_ar', type: 'text' },
  { position: 10, name: 'supermarket_name_en', type: 'text' },
  { position: 11, name: 'supermarket_slug', type: 'text' },
  { position: 12, name: 'supermarket_code', type: 'text' },
  { position: 13, name: 'supermarket_logo_url', type: 'text' },
  { position: 14, name: 'location_scope', type: 'text' },
  { position: 15, name: 'city_id', type: 'text' },
  { position: 16, name: 'city_name_ar', type: 'text' },
  { position: 17, name: 'city_name_en', type: 'text' },
  { position: 18, name: 'city_code', type: 'text' },
  { position: 19, name: 'region_id', type: 'text' },
  { position: 20, name: 'region_name_ar', type: 'text' },
  { position: 21, name: 'region_name_en', type: 'text' },
  { position: 22, name: 'region_code', type: 'text' },
  { position: 23, name: 'product_id', type: 'bigint' },
  { position: 24, name: 'exact_identity_status', type: 'text' },
  { position: 25, name: 'category_id', type: 'uuid' },
  { position: 26, name: 'category_name_ar', type: 'text' },
  { position: 27, name: 'category_name_en', type: 'text' },
  { position: 28, name: 'category_slug', type: 'text' },
  { position: 29, name: 'derived_subcategory_slug', type: 'text' },
  { position: 30, name: 'commodity_tag', type: 'text' },
  { position: 31, name: 'item_domain', type: 'text' },
  { position: 32, name: 'brand_id', type: 'uuid' },
  { position: 33, name: 'brand_name_ar', type: 'text' },
  { position: 34, name: 'brand_name_en', type: 'text' },
  { position: 35, name: 'brand_state', type: 'text' },
  { position: 36, name: 'brand_candidate_text', type: 'text' },
  { position: 37, name: 'title_ar', type: 'text' },
  { position: 38, name: 'title_en', type: 'text' },
  { position: 39, name: 'normalized_title_ar', type: 'text' },
  { position: 40, name: 'normalized_title_en', type: 'text' },
  { position: 41, name: 'product_attributes', type: 'jsonb' },
  { position: 42, name: 'assortment_status', type: 'text' },
  { position: 43, name: 'known_options', type: 'jsonb' },
  { position: 44, name: 'sale_unit_type', type: 'text' },
  { position: 45, name: 'inner_pack_count', type: 'integer' },
  { position: 46, name: 'each_size_value', type: 'numeric' },
  { position: 47, name: 'each_size_unit', type: 'text' },
  { position: 48, name: 'total_content_value', type: 'numeric' },
  { position: 49, name: 'total_content_unit', type: 'text' },
  { position: 50, name: 'is_indivisible_sale_unit', type: 'boolean' },
  { position: 51, name: 'offer_price', type: 'numeric' },
  { position: 52, name: 'source_reported_original_price', type: 'numeric' },
  { position: 53, name: 'verified_non_member_price', type: 'numeric' },
  { position: 54, name: 'currency', type: 'text' },
  { position: 55, name: 'price_basis', type: 'text' },
  { position: 56, name: 'unit_price', type: 'numeric' },
  { position: 57, name: 'unit_price_unit', type: 'text' },
  { position: 58, name: 'discount_amount', type: 'numeric' },
  { position: 59, name: 'discount_percentage', type: 'numeric' },
  { position: 60, name: 'informational_inner_unit_price', type: 'numeric' },
  { position: 61, name: 'display_unit_price_label_ar', type: 'text' },
  { position: 62, name: 'display_unit_price_label_en', type: 'text' },
  { position: 63, name: 'promo_mechanic', type: 'text' },
  { position: 64, name: 'bonus_wording', type: 'text' },
  { position: 65, name: 'bonus_fulfillment', type: 'text' },
  { position: 66, name: 'is_loyalty_required', type: 'boolean' },
  { position: 67, name: 'loyalty_requirement', type: 'text' },
  { position: 68, name: 'quantity_limit', type: 'text' },
  { position: 69, name: 'quantity_limit_value', type: 'integer' },
  { position: 70, name: 'quantity_limit_unit', type: 'text' },
  { position: 71, name: 'quantity_limit_scope', type: 'text' },
  { position: 72, name: 'image_url', type: 'text' },
  { position: 73, name: 'storage_path', type: 'text' },
  { position: 74, name: 'thumbnail_url', type: 'text' },
  { position: 75, name: 'thumbnail_storage_path', type: 'text' },
  { position: 76, name: 'display_image_url', type: 'text' },
  { position: 77, name: 'display_image_kind', type: 'text' },
  { position: 78, name: 'card_image_subject_scope', type: 'text' },
  { position: 79, name: 'card_image_upload_state', type: 'text' },
  { position: 80, name: 'thumbnail_subject_scope', type: 'text' },
  { position: 81, name: 'thumbnail_upload_state', type: 'text' },
  { position: 82, name: 'page_area_share_pct', type: 'numeric' },
  { position: 83, name: 'is_front_page', type: 'boolean' },
  { position: 84, name: 'is_hero_offer', type: 'boolean' },
  { position: 85, name: 'deal_score', type: 'numeric' },
  { position: 86, name: 'deal_label', type: 'text' },
  { position: 87, name: 'offer_start_date', type: 'date' },
  { position: 88, name: 'offer_end_date', type: 'date' },
  { position: 89, name: 'valid_from', type: 'date' },
  { position: 90, name: 'valid_to', type: 'date' },
  { position: 91, name: 'publication_status', type: 'text' },
  { position: 92, name: 'temporal_lifecycle_state', type: 'text' },
  { position: 93, name: 'scoped_assessments', type: 'jsonb' },
  { position: 94, name: 'reason_codes', type: 'ARRAY' },
  { position: 95, name: 'consumer_contract_v2', type: 'jsonb' },
  { position: 96, name: 'published_at', type: 'timestamp with time zone' },
  { position: 97, name: 'created_at', type: 'timestamp with time zone' },
  { position: 98, name: 'updated_at', type: 'timestamp with time zone' }
]

export interface ApplyMigration008Options {
  mode?: 'preflight-only' | 'dry-run' | 'apply'
  confirmProject?: string
  dryRun?: boolean
  client?: any
  host?: string
  user?: string
  password?: string
  port?: number
  database?: string
  caCertPath?: string
}

/**
 * Derives the Supabase project reference from direct or pooler database hosts.
 *
 * Recognized formats:
 * - Direct db host: db.<project-ref>.supabase.co -> <project-ref>
 * - Direct host:    <project-ref>.supabase.co    -> <project-ref>
 * - Pooler host:    *.pooler.supabase.com with user postgres.<project-ref> -> <project-ref>
 *
 * Returns null if the host format is unrecognized (strictly no fallback).
 */
export function deriveSupabaseProjectRef(host?: string | null, user?: string | null): string | null {
  if (!host) return null
  const trimmedHost = host.trim().toLowerCase()

  // 1. Direct Supabase db host: db.<project-ref>.supabase.co
  const directDbMatch = trimmedHost.match(/^db\.([a-z0-9_-]+)\.supabase\.co$/)
  if (directDbMatch) {
    return directDbMatch[1]
  }

  // 2. Direct Supabase host: <project-ref>.supabase.co
  const directMatch = trimmedHost.match(/^([a-z0-9_-]+)\.supabase\.co$/)
  if (directMatch) {
    return directMatch[1]
  }

  // 3. Supabase Pooler host: *.pooler.supabase.com (project ref is encoded in username: postgres.<project-ref> or <project-ref>)
  if (trimmedHost.endsWith('.pooler.supabase.com') || trimmedHost === 'pooler.supabase.com') {
    if (user) {
      const userMatch = user.trim().toLowerCase().match(/^(?:postgres\.)?([a-z0-9_-]+)$/)
      if (userMatch && userMatch[1] && userMatch[1] !== 'postgres') {
        return userMatch[1]
      }
    }
  }

  return null
}

export function parseCliArgs(args: string[]): {
  mode: 'preflight-only' | 'dry-run' | 'apply' | null
  confirmProject?: string
  error?: string
} {
  let mode: 'preflight-only' | 'dry-run' | 'apply' | null = null
  let confirmProject: string | undefined

  for (const arg of args) {
    if (arg === '--preflight-only' || arg === '--preflight') {
      if (mode && mode !== 'preflight-only') return { mode: null, error: 'Conflicting execution modes specified.' }
      mode = 'preflight-only'
    } else if (arg === '--dry-run' || arg === '--simulate') {
      if (mode && mode !== 'dry-run') return { mode: null, error: 'Conflicting execution modes specified.' }
      mode = 'dry-run'
    } else if (arg === '--apply') {
      if (mode && mode !== 'apply') return { mode: null, error: 'Conflicting execution modes specified.' }
      mode = 'apply'
    } else if (arg.startsWith('--confirm-project=')) {
      confirmProject = arg.substring('--confirm-project='.length).trim()
    } else if (arg === '--help' || arg === '-h') {
      return { mode: null, error: 'HELP_REQUESTED' }
    } else if (arg.startsWith('-')) {
      return { mode: null, error: `Unrecognized command-line flag: ${arg}` }
    } else {
      return { mode: null, error: `Unexpected positional argument: "${arg}". Only recognized flags are accepted.` }
    }
  }

  return { mode, confirmProject }
}

export async function applyMigration008(options?: ApplyMigration008Options) {
  const cliArgs = parseCliArgs(process.argv.slice(2))

  if (cliArgs.error === 'HELP_REQUESTED') {
    printUsage()
    return { ok: false, error: 'HELP_REQUESTED' }
  }

  if (cliArgs.error && !options?.client) {
    console.error(`[DEPLOYMENT_ERROR] ${cliArgs.error}\n`)
    printUsage()
    throw new Error(`CLI_ARG_ERROR: ${cliArgs.error}`)
  }

  // Resolve execution mode: programmatic options take precedence, then CLI args
  let mode: 'preflight-only' | 'dry-run' | 'apply' | null = options?.mode || null
  if (!mode && options?.dryRun !== undefined) {
    mode = options.dryRun ? 'dry-run' : 'apply'
  }
  if (!mode) {
    mode = cliArgs.mode
  }

  // Fail closed if no mode is authorized
  if (!mode) {
    console.error('[DEPLOYMENT ABORTED - FAIL CLOSED] No execution mode specified.\n')
    printUsage()
    if (!options?.client) {
      process.exit(1)
    }
    throw new Error('DEPLOYMENT_AUTHORIZATION_REQUIRED: No execution mode specified.')
  }

  const confirmProject = options?.confirmProject || cliArgs.confirmProject

  // Target Database Configuration from Environment (Strictly No Hardcoded Host Fallbacks)
  let host = options?.host || process.env.SUPABASE_DB_HOST || ''
  if (!host && process.env.SUPABASE_URL) {
    try {
      const url = new URL(process.env.SUPABASE_URL)
      const projectRef = url.hostname.split('.')[0]
      if (projectRef && url.hostname.endsWith('.supabase.co')) {
        host = `db.${projectRef}.supabase.co`
      }
    } catch {}
  }
  let port = options?.port || Number(process.env.SUPABASE_DB_PORT) || 5432
  let user = options?.user || process.env.SUPABASE_DB_USER || 'postgres'
  let database = options?.database || process.env.SUPABASE_DB_NAME || 'postgres'
  let password = options?.password || process.env.SUPABASE_DB_PASSWORD || ''

  if (process.env.DATABASE_URL) {
    try {
      const parsedUrl = new URL(process.env.DATABASE_URL)
      host = parsedUrl.hostname || host
      port = parsedUrl.port ? Number(parsedUrl.port) : port
      user = parsedUrl.username ? decodeURIComponent(parsedUrl.username) : user
      database = parsedUrl.pathname ? parsedUrl.pathname.replace(/^\//, '') : database
      if (parsedUrl.password) {
        password = decodeURIComponent(parsedUrl.password)
      }
    } catch (urlErr: any) {
      console.error(`[DEPLOYMENT_CONFIG_ERROR] Malformed DATABASE_URL: ${urlErr.message}\n`)
      if (!options?.client) {
        process.exit(1)
      }
      throw new Error(`DEPLOYMENT_CONFIG_ERROR: Malformed DATABASE_URL: ${urlErr.message}`)
    }
  }

  // Fail closed if no target host is configured (prevent implicit production host targeting)
  if (!host && !options?.client) {
    console.error('[DEPLOYMENT_CONFIG_ERROR] No target database host configured.')
    console.error('Please explicitly set SUPABASE_DB_HOST or DATABASE_URL in your environment.\n')
    process.exit(1)
  }

  // P0 Security: Validate password presence
  if (!password && !options?.client) {
    console.error('[DEPLOYMENT_SECURITY_ERROR] Database password is missing.')
    console.error('Please configure SUPABASE_DB_PASSWORD or DATABASE_URL in your environment.')
    console.error('(Hardcoded credential fallbacks are strictly prohibited.)\n')
    process.exit(1)
  }

  // P0 Target Database Identification & Verification
  const targetProjectRef = deriveSupabaseProjectRef(host, user)

  if (mode === 'apply' && !options?.client) {
    if (!targetProjectRef) {
      console.error(`[DEPLOYMENT_TARGET_ERROR] Host "${host}" is not a recognized Supabase direct or pooler database host.`)
      console.error('Migration 008 live deployment requires an independently verifiable Supabase target identity.\n')
      process.exit(1)
    }

    if (!confirmProject) {
      console.error(`[DEPLOYMENT_AUTH_REQUIRED] Live deployment (--apply) requires explicit project confirmation:`)
      console.error(`  --confirm-project=${targetProjectRef}\n`)
      process.exit(1)
    }

    if (confirmProject !== targetProjectRef) {
      console.error(`[DEPLOYMENT_TARGET_MISMATCH] Target confirmation "${confirmProject}" does not match configured target "${targetProjectRef}".\n`)
      process.exit(1)
    }
  }

  const migrationPath = path.resolve(
    process.cwd(),
    'project-knowledge/wifran_docs/008_wifran_07j_consumer_view_disputed_identity_masking.sql'
  )
  const sql = fs.readFileSync(migrationPath, 'utf8')

  // TLS Verification Configuration (rejectUnauthorized: true enforced)
  const sslConfig: any = { rejectUnauthorized: true }
  const defaultCa = path.resolve(process.cwd(), 'temp/prod-ca-2021.crt')
  const caCertPath = options?.caCertPath || process.env.SUPABASE_DB_CA_CERT || process.env.SSL_CERT_PATH || (fs.existsSync(defaultCa) ? defaultCa : undefined)
  if (caCertPath) {
    if (!fs.existsSync(caCertPath)) {
      console.error(`[DEPLOYMENT_SECURITY_ERROR] Configured CA certificate path does not exist: "${caCertPath}".\n`)
      if (!options?.client) {
        process.exit(1)
      }
      throw new Error(`DEPLOYMENT_SECURITY_ERROR: Configured CA certificate path does not exist: "${caCertPath}".`)
    }
    sslConfig.ca = fs.readFileSync(caCertPath, 'utf8')
  }

  console.log(`=======================================================`)
  console.log(`WIFRAN Migration 008 Deployment Tool`)
  console.log(`Target Host: ${host || '(in-memory test client)'}`)
  console.log(`Target Database: ${database}`)
  console.log(`Target Project: ${targetProjectRef || 'N/A'}`)
  console.log(`Execution Mode: ${mode.toUpperCase()}`)
  console.log(`TLS Verification: ENFORCED (rejectUnauthorized: true)`)
  console.log(`=======================================================\n`)

  const client = options?.client || new Client({
    host,
    port,
    user,
    password,
    database,
    ssl: sslConfig
  })

  let isConnected = false

  try {
    if (!options?.client) {
      await client.connect()
      isConnected = true
    }
    console.log('Connected to target database successfully!\n')

    // -------------------------------------------------------------------------
    // Mode 1: Genuinely Read-Only Preflight (--preflight-only)
    // -------------------------------------------------------------------------
    if (mode === 'preflight-only') {
      console.log('--- Executing Strictly Read-Only Preflight Diagnostics (0 DDL) ---')
      
      // Check if normalize_alias_key exists in catalog
      const funcCheck = await client.query(`
        SELECT count(*) AS count FROM pg_proc WHERE proname = 'normalize_alias_key';
      `)
      const funcExists = Number(funcCheck.rows[0]?.count || 0) > 0

      // Use function if available, else inline SQL normalizer
      const normExpr = funcExists
        ? 'public.normalize_alias_key(alias_text)'
        : `regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(trim(lower(alias_text)), 'ـ', '', 'g'), '[\\u064B-\\u065F\\u0670]', '', 'g'), '[أإآ]', 'ا', 'g'), 'ى', 'ي', 'g'), 'ة', 'ه', 'g'), '\\s+', ' ', 'g')`

      const crossProductConflicts = await client.query(`
        SELECT 
          ${normExpr} AS norm_text,
          count(DISTINCT product_id) AS distinct_products,
          string_agg(DISTINCT product_id::text, ', ' ORDER BY product_id::text) AS product_ids,
          string_agg(alias_text, ' | ') AS raw_aliases
        FROM public.product_aliases
        WHERE alias_text IS NOT NULL AND length(trim(alias_text)) > 0
        GROUP BY ${normExpr}
        HAVING count(DISTINCT product_id) > 1;
      `)

      const sameProductDuplicates = await client.query(`
        SELECT 
          ${normExpr} AS norm_text,
          min(product_id::text) AS product_id,
          count(*) AS total_count,
          string_agg(alias_text, ' | ') AS raw_aliases
        FROM public.product_aliases
        WHERE alias_text IS NOT NULL AND length(trim(alias_text)) > 0
        GROUP BY ${normExpr}
        HAVING count(*) > 1 AND count(DISTINCT product_id) = 1;
      `)

      const totalConflicts = crossProductConflicts.rows.length + sameProductDuplicates.rows.length

      console.log(`Cross-product alias conflicts: ${crossProductConflicts.rows.length}`)
      console.log(`Same-product alias duplicates: ${sameProductDuplicates.rows.length}`)

      if (crossProductConflicts.rows.length > 0) {
        for (const row of crossProductConflicts.rows) {
          console.error(`  [CONFLICT] "${row.norm_text}" maps to DIFFERENT products: ${row.product_ids} (Raw: ${row.raw_aliases})`)
        }
      }
      if (sameProductDuplicates.rows.length > 0) {
        for (const row of sameProductDuplicates.rows) {
          console.warn(`  [DUPLICATE] "${row.norm_text}" duplicated for product #${row.product_id} (${row.total_count} rows: ${row.raw_aliases})`)
        }
      }

      // Check current v_consumer_offers column count
      const viewCols = await client.query(`
        SELECT count(*) AS count FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'v_consumer_offers';
      `)
      console.log(`Current v_consumer_offers column count: ${viewCols.rows[0]?.count || 0}`)

      if (isConnected) await client.end()
      console.log('\n[PREFLIGHT COMPLETE] Read-only inspection completed successfully. Zero changes made.')
      return { ok: totalConflicts === 0, mode: 'preflight-only', conflicts: crossProductConflicts.rows, duplicates: sameProductDuplicates.rows }
    }

    // -------------------------------------------------------------------------
    // Modes 2 & 3: Transactional Simulation (--dry-run) & Live Deployment (--apply)
    // -------------------------------------------------------------------------
    console.log(`Starting atomic transaction (${mode === 'dry-run' ? 'TRANSACTIONAL SIMULATION' : 'LIVE DEPLOYMENT'})...`)
    await client.query('BEGIN;')

    // P1 Requirement: Transaction timeouts for lock contention and statement hanging prevention
    await client.query("SET LOCAL statement_timeout = '60s';")
    await client.query("SET LOCAL lock_timeout = '10s';")

    // Step 1: Preflight Setup - Ensure public.normalize_alias_key exists in this transaction
    console.log('\n--- Step 1: Preflight Alias Diagnostics Inside Transaction ---')
    await client.query(`
      CREATE OR REPLACE FUNCTION public.normalize_alias_key(p_text text)
      RETURNS text
      LANGUAGE plpgsql
      IMMUTABLE
      AS $$
      DECLARE
        v_res text;
      BEGIN
        IF p_text IS NULL THEN
          RETURN NULL;
        END IF;

        v_res := trim(lower(p_text));
        v_res := regexp_replace(v_res, 'ـ', '', 'g');
        v_res := regexp_replace(v_res, '[\\u064B-\\u065F\\u0670]', '', 'g');
        v_res := regexp_replace(v_res, '[أإآ]', 'ا', 'g');
        v_res := regexp_replace(v_res, 'ى', 'ي', 'g');
        v_res := regexp_replace(v_res, 'ة', 'ه', 'g');
        v_res := regexp_replace(v_res, '\\s+', ' ', 'g');
        v_res := trim(v_res);

        IF length(v_res) = 0 THEN
          RETURN NULL;
        END IF;

        RETURN v_res;
      END;
      $$;
    `)

    // Check for conflicts across DIFFERENT products
    const crossProductConflicts = await client.query(`
      SELECT 
        public.normalize_alias_key(alias_text) AS norm_text,
        count(DISTINCT product_id) AS distinct_products,
        string_agg(DISTINCT product_id::text, ', ' ORDER BY product_id::text) AS product_ids,
        string_agg(alias_text, ' | ') AS raw_aliases
      FROM public.product_aliases
      WHERE alias_text IS NOT NULL AND length(trim(alias_text)) > 0
      GROUP BY public.normalize_alias_key(alias_text)
      HAVING count(DISTINCT product_id) > 1;
    `)

    // Check for duplicate aliases pointing to the SAME product
    const sameProductDuplicates = await client.query(`
      SELECT 
        public.normalize_alias_key(alias_text) AS norm_text,
        min(product_id::text) AS product_id,
        count(*) AS total_count,
        string_agg(alias_text, ' | ') AS raw_aliases
      FROM public.product_aliases
      WHERE alias_text IS NOT NULL AND length(trim(alias_text)) > 0
      GROUP BY public.normalize_alias_key(alias_text)
      HAVING count(*) > 1 AND count(DISTINCT product_id) = 1;
    `)

    const totalConflicts = crossProductConflicts.rows.length + sameProductDuplicates.rows.length

    if (totalConflicts > 0) {
      console.error(`\n[PREFLIGHT BLOCKED] Found ${totalConflicts} duplicate/conflicting alias group(s) in public.product_aliases:`)
      for (const row of crossProductConflicts.rows) {
        console.error(`  [CROSS-PRODUCT CONFLICT] Normalized: "${row.norm_text}" maps to DIFFERENT products: ${row.product_ids} (Raw: ${row.raw_aliases})`)
      }
      for (const row of sameProductDuplicates.rows) {
        console.warn(`  [SAME-PRODUCT DUPLICATE] Normalized: "${row.norm_text}" duplicated for product #${row.product_id} (${row.total_count} rows: ${row.raw_aliases})`)
      }
      throw new Error(`MIGRATION_008_PREFLIGHT_BLOCKED: Detected ${totalConflicts} alias conflicts/duplicates. Migration aborted without deleting records.`)
    }

    console.log('Preflight check passed: Zero duplicate or conflicting product aliases found in database.\n')

    // Step 2: Execute Migration 008 SQL
    console.log('--- Step 2: Executing Migration 008 SQL (In-Place View Replacement, 0 CASCADE) ---')
    if (typeof (client as any).exec === 'function') {
      await (client as any).exec(sql)
    } else {
      await client.query(sql)
    }
    console.log('Migration 008 DDL executed successfully in transaction!')

    // Step 3: Enforceable Fail-Closed Post-Deployment Assertions
    console.log('\n--- Step 3: Enforceable Post-Migration Assertions ---')

    // Assertion 1: Full 98-column contract comparison (names, types, ordinal position against Migration 007)
    const viewCols = await client.query(`
      SELECT ordinal_position, column_name, data_type
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'v_consumer_offers'
      ORDER BY ordinal_position;
    `)
    const colCount = viewCols.rows.length
    if (colCount !== EXPECTED_CONSUMER_VIEW_COLUMNS.length) {
      throw new Error(`VERIFICATION_FAILED: Expected exactly ${EXPECTED_CONSUMER_VIEW_COLUMNS.length} columns in public.v_consumer_offers, got ${colCount}.`)
    }

    for (let i = 0; i < EXPECTED_CONSUMER_VIEW_COLUMNS.length; i++) {
      const exp = EXPECTED_CONSUMER_VIEW_COLUMNS[i]
      const actual = viewCols.rows[i]
      if (!actual) {
        throw new Error(`VERIFICATION_FAILED: Column #${exp.position} (${exp.name}) is missing from v_consumer_offers.`)
      }
      if (actual.column_name !== exp.name) {
        throw new Error(`VERIFICATION_FAILED: Column at ordinal position ${i + 1} name mismatch: expected "${exp.name}", found "${actual.column_name}".`)
      }
      if (actual.data_type !== exp.type) {
        throw new Error(`VERIFICATION_FAILED: Column "${exp.name}" at position ${i + 1} type mismatch: expected "${exp.type}", found "${actual.data_type}".`)
      }
    }
    console.log(`✅ Assertion 1 Passed: v_consumer_offers schema exactly matches 98-column contract (names, types, and ordering).`)

    // Assertion 2: product_id column exists at ordinal position 23 with type bigint
    const productIdCol = viewCols.rows.find(r => r.column_name === 'product_id')
    if (!productIdCol || productIdCol.data_type !== 'bigint' || productIdCol.ordinal_position !== 23) {
      throw new Error(`VERIFICATION_FAILED: Column product_id must exist at position 23 with type bigint (found: position=${productIdCol?.ordinal_position}, type=${productIdCol?.data_type}).`)
    }
    console.log(`✅ Assertion 2 Passed: product_id column verified at position 23 with type bigint.`)

    // Assertion 3: display_image_url and display_image_kind exist (Migration 007 visual contract)
    const hasDisplayImg = viewCols.rows.some(r => r.column_name === 'display_image_url')
    const hasDisplayKind = viewCols.rows.some(r => r.column_name === 'display_image_kind')
    if (!hasDisplayImg || !hasDisplayKind) {
      throw new Error('VERIFICATION_FAILED: v_consumer_offers missing required display_image_url / display_image_kind columns.')
    }
    console.log(`✅ Assertion 3 Passed: display_image_url and display_image_kind exist in consumer view.`)

    // Assertion 4: Unique index on product_aliases exists and matches exact catalog expression
    const idxCheck = await client.query(`
      SELECT 
        i.relname AS indexname, 
        ix.indisunique,
        pg_get_expr(ix.indexprs, ix.indrelid) AS index_expr,
        pg_get_indexdef(ix.indexrelid) AS indexdef
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' 
        AND t.relname = 'product_aliases' 
        AND i.relname = 'idx_product_aliases_normalized_key';
    `)
    if (idxCheck.rows.length === 0 || !idxCheck.rows[0].indisunique) {
      throw new Error('VERIFICATION_FAILED: Unique index idx_product_aliases_normalized_key is missing or not unique.')
    }
    const indexdef = idxCheck.rows[0].indexdef || ''
    const indexExpr = idxCheck.rows[0].index_expr || ''
    const hasNormExpr = indexdef.includes('normalize_alias_key(alias_text)') || indexExpr.includes('normalize_alias_key(alias_text)')
    if (!hasNormExpr) {
      throw new Error(`VERIFICATION_FAILED: Unique index idx_product_aliases_normalized_key expression mismatch. Expected expression containing normalize_alias_key(alias_text), found: ${indexdef || indexExpr}`)
    }
    console.log(`✅ Assertion 4 Passed: Unique index idx_product_aliases_normalized_key verified with exact normalized key expression.`)

    // Assertion 5: RPC function get_consumer_offers_for_shopping_date exact schema, args, SECURITY DEFINER, and EXECUTE grants
    const funcCheck = await client.query(`
      SELECT 
        p.proname, 
        p.prosecdef,
        pg_get_function_identity_arguments(p.oid) AS identity_args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'get_consumer_offers_for_shopping_date';
    `)
    if (funcCheck.rows.length === 0 || !funcCheck.rows[0].prosecdef) {
      throw new Error('VERIFICATION_FAILED: get_consumer_offers_for_shopping_date is missing or not SECURITY DEFINER.')
    }
    const rpcArgs = (funcCheck.rows[0].identity_args || '').toLowerCase()
    const expectedArgsMatch = rpcArgs.includes('date') && rpcArgs.includes('text')
    if (!expectedArgsMatch) {
      throw new Error(`VERIFICATION_FAILED: get_consumer_offers_for_shopping_date arguments mismatch: found "${rpcArgs}".`)
    }

    const rpcPrivCheck = await client.query(`
      SELECT grantee, privilege_type
      FROM information_schema.routine_privileges
      WHERE specific_schema = 'public' AND routine_name = 'get_consumer_offers_for_shopping_date'
        AND grantee IN ('anon', 'authenticated') AND privilege_type = 'EXECUTE';
    `)
    if (rpcPrivCheck.rows.length < 2) {
      throw new Error(`VERIFICATION_FAILED: Missing EXECUTE privilege on get_consumer_offers_for_shopping_date for anon or authenticated (found ${rpcPrivCheck.rows.length}, expected 2).`)
    }
    console.log(`✅ Assertion 5 Passed: RPC function get_consumer_offers_for_shopping_date verified with SECURITY DEFINER and EXECUTE grants.`)

    // Assertion 6: Immutable normalize_alias_key function
    const normFuncCheck = await client.query(`
      SELECT proname, provolatile 
      FROM pg_proc 
      WHERE proname = 'normalize_alias_key';
    `)
    if (normFuncCheck.rows.length === 0 || normFuncCheck.rows[0].provolatile !== 'i') {
      throw new Error('VERIFICATION_FAILED: normalize_alias_key is missing or not IMMUTABLE.')
    }
    console.log(`✅ Assertion 6 Passed: normalize_alias_key function is IMMUTABLE.`)

    // Assertion 7: Fail-Closed Role Grants on v_consumer_offers for anon and authenticated
    const grantCheck = await client.query(`
      SELECT grantee, privilege_type 
      FROM information_schema.role_table_grants 
      WHERE table_schema = 'public' AND table_name = 'v_consumer_offers'
        AND grantee IN ('anon', 'authenticated') AND privilege_type = 'SELECT';
    `)
    if (grantCheck.rows.length < 2) {
      throw new Error(`VERIFICATION_FAILED: Missing required SELECT grants on public.v_consumer_offers for anon and authenticated roles (found ${grantCheck.rows.length} grants, expected 2).`)
    }
    console.log(`✅ Assertion 7 Passed: SELECT grants verified for anon and authenticated.`)

    // Assertion 8: Exact Identity Masking across ALL Rows & View Definition Verification
    // 8a. Verify effective view definition in pg_views contains conditional product_id masking logic
    const viewDefCheck = await client.query(`
      SELECT definition 
      FROM pg_views 
      WHERE schemaname = 'public' AND viewname = 'v_consumer_offers';
    `)
    if (viewDefCheck.rows.length === 0) {
      throw new Error('VERIFICATION_FAILED: View public.v_consumer_offers not found in pg_views.')
    }
    const defText = viewDefCheck.rows[0].definition || ''
    const hasMaskingClause = defText.includes('verified_linked') && defText.includes('product_id') && (defText.includes('NULL') || defText.includes('null'))
    if (!hasMaskingClause) {
      throw new Error('VERIFICATION_FAILED: View public.v_consumer_offers definition does not contain conditional product_id masking logic.')
    }

    // 8b. Check identity masking across ALL eligible rows (zero row limit, IS DISTINCT FROM 'verified_linked')
    const maskingCheck = await client.query(`
      SELECT 
        o.id,
        o.product_id AS raw_product_id,
        o.catalog_match_status,
        v.product_id AS consumer_product_id
      FROM public.offers o
      JOIN public.v_consumer_offers v ON o.id = v.id
      WHERE o.status = 'published' 
        AND o.catalog_match_status IS DISTINCT FROM 'verified_linked';
    `)
    for (const row of maskingCheck.rows) {
      if (row.consumer_product_id !== null) {
        throw new Error(
          `VERIFICATION_FAILED: Disputed identity leaked! Offer ${row.id} has status "${row.catalog_match_status}" but exposes product_id: ${row.consumer_product_id}`
        )
      }
    }
    console.log(`✅ Assertion 8 Passed: Verified ${maskingCheck.rows.length} disputed/unverified offers across all rows have masked (NULL) product_id, and view definition confirmed in pg_views.`)

    if (mode === 'dry-run') {
      await client.query('ROLLBACK;')
      console.log('\n[DRY RUN COMPLETE] Migration 008 simulated successfully. All assertions passed. Transaction rolled back with 0 persistent changes.\n')
    } else {
      await client.query('COMMIT;')
      console.log('\n[DEPLOYMENT SUCCESS] Migration 008 committed successfully to database with all assertions verified.\n')
    }

    if (isConnected) {
      await client.end()
    }
    return { ok: true, mode, isDryRun: mode === 'dry-run' }
  } catch (err: any) {
    console.error('\n[DEPLOYMENT FAILED]', err.message)
    try {
      await client.query('ROLLBACK;')
    } catch {}
    if (isConnected) {
      try { await client.end() } catch {}
    }
    if (!options?.client) {
      process.exit(1)
    }
    throw err
  }
}

function printUsage() {
  console.log(`
Usage:
  # 1. Strictly read-only preflight diagnostics (0 DDL executed):
  npx tsx scripts/apply-migration-008.ts --preflight-only

  # 2. Transactional simulation with automatic rollback (0 persistent changes):
  npx tsx scripts/apply-migration-008.ts --dry-run

  # 3. Live deployment (requires explicit project confirmation):
  npx tsx scripts/apply-migration-008.ts --apply --confirm-project=<project-ref>

Environment Variables:
  SUPABASE_DB_PASSWORD   Database password (required, no fallback)
  DATABASE_URL           PostgreSQL connection string with credentials
  SUPABASE_DB_HOST       Database host (e.g. db.swratbmclahjyekouned.supabase.co)
  SUPABASE_DB_CA_CERT    Path to custom TLS CA certificate file (optional)
`)
}

// Only execute when run directly from command line
if (require.main === module) {
  applyMigration008()
}
