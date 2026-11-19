/**
 * Dynamic Database Schema Compatibility & Migration Parity Verifier
 * Milestone: WIFRAN-EXTRACTOR-IDENTITY-005J-UAT-FIX-08 (PUB-02, MIG-04)
 *
 * Replaces unconditional environment blocks with dynamic runtime inspection of:
 * - Target Supabase project identity (fail-closed isolation)
 * - Migrations 001–010 tables, columns, unique indexes, views, and functions
 * - Required storage bucket readiness (when verifiable)
 */

import {
  createGuardedPgClient,
  resolveDatabaseConfig,
  DEVELOPMENT_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  type DatabaseContext
} from './databaseEnvironmentResolver'

export interface SqlQueryable {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>
  end?: () => Promise<void>
}

export interface SchemaCompatibilityReport {
  compatible: boolean
  context: DatabaseContext
  projectRef: string
  checkedAt: string
  hasMigration009: boolean
  hasMigration010: boolean
  hasConsumerView: boolean
  hasSourceOfferUniqueIndex: boolean
  hasRequiredColumns: boolean
  storageBucketsVerified: boolean | null
  missingDependencies: string[]
  blockingReasons: string[]
  details: Record<string, boolean>
}

export async function assessSchemaCompatibility(params: {
  context: DatabaseContext
  pgClient?: SqlQueryable
  requiredBucket?: string
  bucketChecker?: (bucketName: string) => Promise<boolean>
  allowIsolatedTestDb?: boolean
}): Promise<SchemaCompatibilityReport> {
  const checkedAt = new Date().toISOString()
  let projectRef = params.allowIsolatedTestDb ? 'isolated_local_pg' : ''
  let ownClient: SqlQueryable | null = null
  const missingDependencies: string[] = []
  const blockingReasons: string[] = []
  const details: Record<string, boolean> = {}

  try {
    if (!params.allowIsolatedTestDb) {
      const cfg = resolveDatabaseConfig(params.context)
      projectRef = cfg.projectRef
      const expectedRef =
        params.context === 'PRODUCTION_UI' ? PRODUCTION_PROJECT_REF : DEVELOPMENT_PROJECT_REF
      if (projectRef !== expectedRef) {
        blockingReasons.push(
          `PROJECT_REF_MISMATCH: Context ${params.context} resolved ${projectRef}, expected ${expectedRef}.`
        )
      }
    }

    const client =
      params.pgClient ||
      (() => {
        const pg = createGuardedPgClient(params.context)
        ownClient = pg
        return pg
      })()

    if (ownClient && typeof (ownClient as any).connect === 'function') {
      await (ownClient as any).connect()
    }

    const tableRes = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [
        [
          'supermarkets',
          'products',
          'offers',
          'product_images',
          'offer_display_images',
          'product_alias_proposals',
          'product_alias_audit_log',
          'publication_operations',
          'publication_journal_mutations',
          'publication_duplicate_skips',
          'publication_storage_operations'
        ]
      ]
    )
    const tableSet = new Set(tableRes.rows.map((r) => r.table_name))

    const requiredTables = [
      'supermarkets',
      'products',
      'offers',
      'product_images',
      'offer_display_images',
      'product_alias_proposals',
      'product_alias_audit_log',
      'publication_operations',
      'publication_journal_mutations',
      'publication_duplicate_skips',
      'publication_storage_operations'
    ]
    for (const tbl of requiredTables) {
      const present = tableSet.has(tbl)
      details[`table:${tbl}`] = present
      if (!present) {
        missingDependencies.push(`Missing table public.${tbl}`)
      }
    }

    const colRes = await client.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'offers'
         AND column_name = ANY($1::text[])`,
      [['source_offer_id', 'source_document_id', 'source_pdf_sha256', 'source_page_hash', 'source_offer_anchor', 'last_publish_operation_id']]
    )
    const colSet = new Set(colRes.rows.map((r) => r.column_name))
    for (const col of ['source_offer_id', 'source_document_id', 'source_pdf_sha256', 'source_page_hash', 'source_offer_anchor', 'last_publish_operation_id']) {
      const present = colSet.has(col)
      details[`col:offers.${col}`] = present
      if (!present) {
        missingDependencies.push(`Missing column public.offers.${col}`)
      }
    }

    const idxRes = await client.query<{ indexdef: string }>(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'offers'
         AND indexdef ILIKE '%UNIQUE%source_offer_id%'`
    )
    const hasSourceOfferUniqueIndex = idxRes.rows.length > 0
    details['index:offers.source_offer_id_unique'] = hasSourceOfferUniqueIndex
    if (!hasSourceOfferUniqueIndex) {
      missingDependencies.push('Missing unique index on public.offers(source_offer_id)')
    }

    const viewRes = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.views
       WHERE table_schema = 'public'
         AND table_name = 'v_consumer_offers'`
    )
    const hasConsumerView = viewRes.rows.length > 0
    details['view:v_consumer_offers'] = hasConsumerView
    if (!hasConsumerView) {
      missingDependencies.push('Missing consumer view public.v_consumer_offers')
    }

    const fnRes = await client.query<{ routine_name: string }>(
      `SELECT routine_name
       FROM information_schema.routines
       WHERE routine_schema = 'public'
         AND routine_name = ANY($1::text[])`,
      [['approve_product_alias_atomic', 'check_wifran_schema_readiness']]
    )
    const fnSet = new Set(fnRes.rows.map((r) => r.routine_name))
    for (const fn of ['approve_product_alias_atomic', 'check_wifran_schema_readiness']) {
      const present = fnSet.has(fn)
      details[`fn:${fn}`] = present
      if (!present) {
        missingDependencies.push(`Missing function public.${fn}`)
      }
    }

    let storageBucketsVerified: boolean | null = null
    if (params.bucketChecker && params.requiredBucket) {
      storageBucketsVerified = await params.bucketChecker(params.requiredBucket)
      details[`bucket:${params.requiredBucket}`] = storageBucketsVerified
      if (!storageBucketsVerified) {
        missingDependencies.push(`Missing required storage bucket "${params.requiredBucket}"`)
      }
    }

    const hasMigration009 =
      details['table:product_alias_proposals'] &&
      details['table:product_alias_audit_log'] &&
      details['fn:approve_product_alias_atomic']
    const hasMigration010 =
      details['table:publication_operations'] &&
      details['table:publication_journal_mutations'] &&
      details['table:publication_duplicate_skips'] &&
      details['table:publication_storage_operations'] &&
      details['col:offers.source_document_id'] &&
      hasSourceOfferUniqueIndex
    const hasRequiredColumns =
      details['col:offers.source_offer_id'] &&
      details['col:offers.source_document_id'] &&
      details['col:offers.source_pdf_sha256'] &&
      details['col:offers.source_page_hash'] &&
      details['col:offers.source_offer_anchor']

    if (missingDependencies.length > 0) {
      blockingReasons.push(
        `SCHEMA_MIGRATION_REQUIRED: Target ${params.context} database (${projectRef}) is missing required migration objects: ${missingDependencies.join('; ')}. Run controlled deployment Migrations 009 & 010 before publishing.`
      )
    }

    return {
      compatible: blockingReasons.length === 0 && missingDependencies.length === 0,
      context: params.context,
      projectRef,
      checkedAt,
      hasMigration009,
      hasMigration010,
      hasConsumerView,
      hasSourceOfferUniqueIndex,
      hasRequiredColumns,
      storageBucketsVerified,
      missingDependencies,
      blockingReasons,
      details
    }
  } catch (err: any) {
    blockingReasons.push(`SCHEMA_CHECK_FAILED: ${err?.message || String(err)}`)
    return {
      compatible: false,
      context: params.context,
      projectRef: projectRef || 'unconfigured',
      checkedAt,
      hasMigration009: false,
      hasMigration010: false,
      hasConsumerView: false,
      hasSourceOfferUniqueIndex: false,
      hasRequiredColumns: false,
      storageBucketsVerified: null,
      missingDependencies,
      blockingReasons,
      details
    }
  } finally {
    if (ownClient && typeof ownClient.end === 'function') {
      await ownClient.end().catch(() => {})
    }
  }
}
