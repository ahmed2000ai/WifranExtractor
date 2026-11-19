import fs from 'fs'
import path from 'path'
import { PGlite } from '@electric-sql/pglite'
// @ts-expect-error pglite contrib subpath is resolved at runtime via package exports
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import type { SqlQueryable } from '../schemaCompatibilityService'

const MIGRATION_PATHS = [
  'project-knowledge/wifran_docs/001_initial_schema.sql',
  'project-knowledge/wifran_docs/001_seed_core_catalog.sql',
  'project-knowledge/wifran_docs/003_offer_location_scope.sql',
  'project-knowledge/wifran_docs/004_offer_image_ingestion_metadata.sql',
  'project-knowledge/wifran_docs/005_wifran_v2_offer_contract.sql',
  'project-knowledge/wifran_docs/006_wifran_07a_security_and_contract_reconciliation.sql',
  'project-knowledge/wifran_docs/007_wifran_07g_07h_catalog_resolution_and_product_images.sql',
  'project-knowledge/wifran_docs/008_wifran_07j_consumer_view_disputed_identity_masking.sql',
  'project-knowledge/wifran_docs/009_wifran_07j_product_alias_staging_and_audit.sql',
  'project-knowledge/wifran_docs/010_wifran_08_publication_journal_and_uniqueness.sql',
  'project-knowledge/wifran_docs/011_wifran_mvp_candidate_consumer_visibility.sql',
  'project-knowledge/wifran_docs/012_wifran_offer_display_image_precedence.sql',
  'project-knowledge/wifran_docs/013_wifran_product_verification_defaults.sql'
]

/**
 * Strips Supabase-only storage/auth schema bootstrap blocks when running against
 * vanilla local PostgreSQL / PGlite where `auth` or `storage` schemas aren't installed.
 */
function adaptSqlForVanillaPostgres(sql: string): string {
  return sql
    // PGlite natively supports gen_random_uuid() without extension packages
    .replace(/^\s*CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+["']?(?:pgcrypto|uuid-ossp)["']?(?:\s+WITH\s+SCHEMA\s+\w+)?\s*;/gim, '-- stripped extension DDL for PGlite')
    .replace(/^\s*CREATE\s+EXTENSION\s+["']?(?:pgcrypto|uuid-ossp)["']?(?:\s+WITH\s+SCHEMA\s+\w+)?\s*;/gim, '-- stripped extension DDL for PGlite')
}

export async function createIsolatedWifranPostgres(options?: {
  upToMigration?: number
}): Promise<{ db: PGlite; client: SqlQueryable }> {
  const db = new PGlite({
    extensions: { pg_trgm }
  })

  // Seed Supabase prerequisite schemas/roles so 001..010 execute cleanly in vanilla PostgreSQL / PGlite
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql VOLATILE AS $$ SELECT gen_random_uuid() $$;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text,
      created_at timestamptz DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;

    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[],
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
  `)

  const maxIdx = options?.upToMigration ?? MIGRATION_PATHS.length
  for (let i = 0; i < Math.min(maxIdx, MIGRATION_PATHS.length); i++) {
    const filePath = path.resolve(process.cwd(), MIGRATION_PATHS[i])
    const sql = adaptSqlForVanillaPostgres(fs.readFileSync(filePath, 'utf8'))
    try {
      await db.exec(sql)
    } catch (err: any) {
      throw new Error(`Failed executing ${MIGRATION_PATHS[i]}: ${err?.message || err}`)
    }
  }

  // Wrap PGlite with standard SqlQueryable contract supporting pg-style parameterized queries
  const client: SqlQueryable = {
    query: async <T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> => {
      const trimmed = sql.trim().replace(/;+\s*$/, '')
      if ((!params || params.length === 0) && trimmed.includes(';')) {
        const results = await db.exec(sql)
        const lastWithRows = [...results].reverse().find((r) => Array.isArray(r.rows))
        return { rows: (lastWithRows?.rows ?? []) as T[] }
      }
      const res = await db.query<T>(sql, params)
      return { rows: res.rows }
    },
    end: async () => {
      await db.close()
    }
  }

  return { db, client }
}
