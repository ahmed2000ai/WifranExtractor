/**
 * Durable Publication Transaction Journal & Atomic Undo Last Publish Service
 * Milestone: WIFRAN-EXTRACTOR-IDENTITY-005J-UAT-FIX-08 (JOURNAL-01..05, REV-01..14, DB-01..03)
 */

import crypto from 'crypto'
import type { DatabaseContext } from './databaseEnvironmentResolver'
import type { SqlQueryable } from './schemaCompatibilityService'
import {
  cleanupExclusiveStorageForUndoneOperation,
  type StorageLifecycleAdapter
} from '../storage/stagedStorageLifecycleService'

export type PublicationOperationStatus =
  | 'in_progress'
  | 'completed'
  | 'noop'
  | 'failed'
  | 'undo_in_progress'
  | 'undo_blocked'
  | 'undo_cleanup_pending'
  | 'undone'
  | 'undo_failed'

export interface PublicationOperationRecord {
  publishOperationId: string
  idempotencyKey: string
  payloadFingerprint: string
  targetProjectRef: string
  environmentContext: DatabaseContext | 'ISOLATED_TEST'
  batchId: string
  sourceDocumentIds: string[]
  operatorId: string
  status: PublicationOperationStatus
  requestedOffersCount: number
  insertedOffersCount: number
  updatedOffersCount: number
  unchangedNoopCount: number
  skippedDuplicatesCount: number
  conflictsCount: number
  createdProductsCount: number
  reusedProductsCount: number
  storageObjectsUploaded: number
  storageObjectsReused: number
  storageSummary: Record<string, unknown>
  preflightSummary: Record<string, unknown>
  undoEligible: boolean
  undoTargetOperationId?: string | null
  undoneByOperationId?: string | null
  undoRequestedBy?: string | null
  undoReason?: string | null
  undoBlockedReason?: string | null
  errorDiagnostics?: Record<string, unknown> | null
  startedAt: string
  completedAt?: string | null
  undoneAt?: string | null
}

export interface JournalMutationEntry {
  id: string
  publishOperationId: string
  sequenceNo: number
  tableName: string
  recordPk: string
  mutationType: 'insert' | 'update' | 'delete'
  captureSource: 'application_tx' | 'db_trigger'
  preState: Record<string, any> | null
  postState: Record<string, any> | null
  postStateHash: string | null
  reusedExisting: boolean
  metadata: Record<string, any>
  createdAt: string
}

export interface UndoPreviewResult {
  canUndo: boolean
  targetOperation: PublicationOperationRecord | null
  alreadyUndone: boolean
  blockedReasons: string[]
  warnings: string[]
  affectedCounts: {
    offersToDelete: number
    offersToRestore: number
    productsToDelete: number
    productsReusedPreserved: number
    aliasesToDelete: number
    imagesToDelete: number
    exclusiveStorageObjectsToDelete: number
    reusedStorageObjectsPreserved: number
  }
  sampleChanges: Array<{
    tableName: string
    recordPk: string
    action: string
    label: string
  }>
}

export interface UndoExecutionResult {
  success: boolean
  alreadyUndone?: boolean
  status: PublicationOperationStatus | 'not_found'
  targetOperationId: string | null
  undoAuditOperationId: string | null
  blockedReasons: string[]
  revertedMutationsCount: number
  storageCleanup: {
    deletedCount: number
    skippedReferencedCount: number
    failedCount: number
    errors: string[]
  }
  message: string
}

function normalizeJsonValue(val: unknown): unknown {
  if (val === null || val === undefined) return null
  if (val instanceof Date) return val.toISOString()
  if (typeof val === 'number') {
    return Number.isFinite(val) ? Number(val.toFixed(6)) : String(val)
  }
  if (Array.isArray(val)) {
    return val.map(normalizeJsonValue)
  }
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(val as Record<string, unknown>).sort()) {
      out[k] = normalizeJsonValue((val as Record<string, unknown>)[k])
    }
    return out
  }
  return val
}

/**
 * Computes a deterministic hash of a database row state excluding volatile `updated_at`
 * so post-publish external edits can be detected accurately across pg and PGlite drivers.
 */
export function computeRowStateHash(row: Record<string, any> | null | undefined): string | null {
  if (!row) return null
  const cloned: Record<string, any> = {}
  for (const key of Object.keys(row).sort()) {
    if (key === 'updated_at') continue
    let v = row[key]
    // PG numeric strings like "5.9500" or bigint strings normalize cleanly if strictly decimal
    if (typeof v === 'string' && /^-?\d+\.\d+$/.test(v)) {
      v = Number(v)
    }
    cloned[key] = normalizeJsonValue(v)
  }
  return crypto.createHash('sha256').update(JSON.stringify(cloned)).digest('hex')
}

export function computePublishPayloadFingerprint(payload: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalizeJsonValue(payload)))
    .digest('hex')
}

export function computeDefaultPublishIdempotencyKey(params: {
  context: DatabaseContext | string
  batchId: string
  payloadFingerprint: string
}): string {
  return crypto
    .createHash('sha256')
    .update(`${params.context}|${params.batchId}|${params.payloadFingerprint}`)
    .digest('hex')
}

function mapOperationRow(row: Record<string, any>): PublicationOperationRecord {
  return {
    publishOperationId: String(row.publish_operation_id),
    idempotencyKey: String(row.idempotency_key),
    payloadFingerprint: String(row.payload_fingerprint),
    targetProjectRef: String(row.target_project_ref),
    environmentContext: row.environment_context,
    batchId: String(row.batch_id),
    sourceDocumentIds: Array.isArray(row.source_document_ids) ? row.source_document_ids : [],
    operatorId: String(row.operator_id),
    status: row.status,
    requestedOffersCount: Number(row.requested_offers_count || 0),
    insertedOffersCount: Number(row.inserted_offers_count || 0),
    updatedOffersCount: Number(row.updated_offers_count || 0),
    unchangedNoopCount: Number(row.unchanged_noop_count || 0),
    skippedDuplicatesCount: Number(row.skipped_duplicates_count || 0),
    conflictsCount: Number(row.conflicts_count || 0),
    createdProductsCount: Number(row.created_products_count || 0),
    reusedProductsCount: Number(row.reused_products_count || 0),
    storageObjectsUploaded: Number(row.storage_objects_uploaded || 0),
    storageObjectsReused: Number(row.storage_objects_reused || 0),
    storageSummary: row.storage_summary || {},
    preflightSummary: row.preflight_summary || {},
    undoEligible: Boolean(row.undo_eligible),
    undoTargetOperationId: row.undo_target_operation_id || null,
    undoneByOperationId: row.undone_by_operation_id || null,
    undoRequestedBy: row.undo_requested_by || null,
    undoReason: row.undo_reason || null,
    undoBlockedReason: row.undo_blocked_reason || null,
    errorDiagnostics: row.error_diagnostics || null,
    startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at),
    completedAt: row.completed_at
      ? row.completed_at instanceof Date
        ? row.completed_at.toISOString()
        : String(row.completed_at)
      : null,
    undoneAt: row.undone_at
      ? row.undone_at instanceof Date
        ? row.undone_at.toISOString()
        : String(row.undone_at)
      : null
  }
}

export async function recordJournalMutation(params: {
  client: SqlQueryable
  publishOperationId: string
  sequenceNo: number
  tableName: string
  recordPk: string | number
  mutationType: 'insert' | 'update' | 'delete'
  preState: Record<string, any> | null
  postState: Record<string, any> | null
  reusedExisting?: boolean
  metadata?: Record<string, any>
}): Promise<number> {
  const seqRes = await params.client.query<{ next_seq: number }>(
    `SELECT GREATEST($2::integer, COALESCE(MAX(sequence_no), 0) + 1)::integer AS next_seq
     FROM public.publication_journal_mutations
     WHERE publish_operation_id = $1`,
    [params.publishOperationId, params.sequenceNo]
  )
  const effectiveSeq = Number(seqRes.rows[0]?.next_seq || params.sequenceNo)
  const postStateHash = computeRowStateHash(params.postState)
  await params.client.query(
    `INSERT INTO public.publication_journal_mutations (
      publish_operation_id,
      sequence_no,
      table_schema,
      table_name,
      record_pk,
      mutation_type,
      capture_source,
      pre_state,
      post_state,
      post_state_hash,
      reused_existing,
      metadata
    ) VALUES ($1, $2, 'public', $3, $4, $5, 'application_tx', $6::jsonb, $7::jsonb, $8, $9, $10::jsonb)`,
    [
      params.publishOperationId,
      effectiveSeq,
      params.tableName,
      String(params.recordPk),
      params.mutationType,
      params.preState ? JSON.stringify(params.preState) : null,
      params.postState ? JSON.stringify(params.postState) : null,
      postStateHash,
      Boolean(params.reusedExisting),
      JSON.stringify(params.metadata || {})
    ]
  )
  return effectiveSeq + 1
}

export async function listPublicationHistory(params: {
  client: SqlQueryable
  limit?: number
  statusFilter?: string | null
  batchIdFilter?: string | null
}): Promise<PublicationOperationRecord[]> {
  const limit = Math.max(1, Math.min(200, params.limit || 50))
  const clauses: string[] = []
  const values: any[] = []
  let idx = 1

  if (params.statusFilter && params.statusFilter !== 'all') {
    clauses.push(`status = $${idx++}`)
    values.push(params.statusFilter)
  }
  if (params.batchIdFilter && params.batchIdFilter.trim()) {
    clauses.push(`batch_id ILIKE $${idx++}`)
    values.push(`%${params.batchIdFilter.trim()}%`)
  }
  values.push(limit)

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const res = await params.client.query<Record<string, any>>(
    `SELECT *
     FROM public.publication_operations
     ${whereSql}
     ORDER BY started_at DESC
     LIMIT $${idx}`,
    values
  )
  return res.rows.map(mapOperationRow)
}

export async function getPublicationOperationDetails(params: {
  client: SqlQueryable
  publishOperationId: string
}): Promise<{
  operation: PublicationOperationRecord | null
  mutations: JournalMutationEntry[]
  duplicateSkips: Array<Record<string, any>>
  storageOperations: Array<Record<string, any>>
}> {
  const opRes = await params.client.query<Record<string, any>>(
    `SELECT * FROM public.publication_operations WHERE publish_operation_id = $1 LIMIT 1`,
    [params.publishOperationId]
  )
  if (opRes.rows.length === 0) {
    return { operation: null, mutations: [], duplicateSkips: [], storageOperations: [] }
  }

  const [mutRes, skipRes, storeRes] = await Promise.all([
    params.client.query<Record<string, any>>(
      `SELECT * FROM public.publication_journal_mutations
       WHERE publish_operation_id = $1
       ORDER BY sequence_no ASC`,
      [params.publishOperationId]
    ),
    params.client.query<Record<string, any>>(
      `SELECT * FROM public.publication_duplicate_skips
       WHERE publish_operation_id = $1
       ORDER BY created_at ASC`,
      [params.publishOperationId]
    ),
    params.client.query<Record<string, any>>(
      `SELECT * FROM public.publication_storage_operations
       WHERE publish_operation_id = $1
       ORDER BY created_at ASC`,
      [params.publishOperationId]
    )
  ])

  return {
    operation: mapOperationRow(opRes.rows[0]),
    mutations: mutRes.rows.map((r) => ({
      id: String(r.id),
      publishOperationId: String(r.publish_operation_id),
      sequenceNo: Number(r.sequence_no),
      tableName: String(r.table_name),
      recordPk: String(r.record_pk),
      mutationType: r.mutation_type,
      captureSource: r.capture_source,
      preState: r.pre_state || null,
      postState: r.post_state || null,
      postStateHash: r.post_state_hash || null,
      reusedExisting: Boolean(r.reused_existing),
      metadata: r.metadata || {},
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
    })),
    duplicateSkips: skipRes.rows,
    storageOperations: storeRes.rows
  }
}

async function resolveLatestUndoTarget(
  client: SqlQueryable,
  requestedOperationId?: string | null
): Promise<{
  target: PublicationOperationRecord | null
  alreadyUndone: boolean
  blockedReasons: string[]
}> {
  const blockedReasons: string[] = []

  // Latest real mutating completed op in DB (REV-01, JOURNAL-05: noop ops are never undoable targets)
  const latestRes = await client.query<Record<string, any>>(
    `SELECT *
     FROM public.publication_operations
     WHERE undo_target_operation_id IS NULL
       AND status IN ('completed', 'undo_cleanup_pending', 'undone')
       AND (inserted_offers_count + updated_offers_count + created_products_count) > 0
     ORDER BY completed_at DESC NULLS LAST, started_at DESC
     LIMIT 1`
  )

  if (requestedOperationId) {
    const reqRes = await client.query<Record<string, any>>(
      `SELECT * FROM public.publication_operations WHERE publish_operation_id = $1 LIMIT 1`,
      [requestedOperationId]
    )
    if (reqRes.rows.length === 0) {
      return {
        target: null,
        alreadyUndone: false,
        blockedReasons: [`Publication operation "${requestedOperationId}" was not found.`]
      }
    }
    const reqOp = mapOperationRow(reqRes.rows[0])
    if (reqOp.status === 'undone' || reqOp.status === 'undo_cleanup_pending') {
      return {
        target: reqOp,
        alreadyUndone: true,
        blockedReasons: [`Operation ${reqOp.publishOperationId} was already undone.`]
      }
    }
    if (reqOp.status === 'noop') {
      return {
        target: reqOp,
        alreadyUndone: false,
        blockedReasons: ['Strict no-op publication made zero database changes and cannot be undone.']
      }
    }
    if (!reqOp.undoEligible || reqOp.status !== 'completed') {
      blockedReasons.push(
        `Operation ${reqOp.publishOperationId} is in state "${reqOp.status}" and is not eligible for Undo.`
      )
    }
    if (
      latestRes.rows.length > 0 &&
      String(latestRes.rows[0].publish_operation_id) !== reqOp.publishOperationId
    ) {
      blockedReasons.push(
        `REV-01 strict ordering violation: A newer operation (${latestRes.rows[0].publish_operation_id}) exists; only the single latest completed publication may be undone.`
      )
    }
    return { target: reqOp, alreadyUndone: false, blockedReasons }
  }

  // Pick the strict latest completed undo-eligible op
  const eligibleRes = await client.query<Record<string, any>>(
    `SELECT *
     FROM public.publication_operations
     WHERE status = 'completed'
       AND undo_eligible = true
       AND undo_target_operation_id IS NULL
     ORDER BY completed_at DESC NULLS LAST, started_at DESC
     LIMIT 1`
  )

  if (eligibleRes.rows.length === 0) {
    if (latestRes.rows.length > 0 && latestRes.rows[0].status === 'undone') {
      return {
        target: mapOperationRow(latestRes.rows[0]),
        alreadyUndone: true,
        blockedReasons: ['The latest completed publication operation has already been undone.']
      }
    }
    return {
      target: null,
      alreadyUndone: false,
      blockedReasons: ['No undo-eligible completed publication operation exists in this database.']
    }
  }

  const target = mapOperationRow(eligibleRes.rows[0])
  return { target, alreadyUndone: false, blockedReasons }
}

async function checkUndoConflictsAndDependencies(params: {
  client: SqlQueryable
  target: PublicationOperationRecord
  mutations: JournalMutationEntry[]
}): Promise<{ blockedReasons: string[]; warnings: string[] }> {
  const blockedReasons: string[] = []
  const warnings: string[] = []

  const revertingOfferIds = new Set(
    params.mutations.filter((m) => m.tableName === 'offers' && m.mutationType === 'insert').map((m) => m.recordPk)
  )
  const deletingProductIds = new Set(
    params.mutations
      .filter((m) => m.tableName === 'products' && m.mutationType === 'insert' && !m.reusedExisting)
      .map((m) => m.recordPk)
  )
  const revertingAliasIds = new Set(
    params.mutations.filter((m) => m.tableName === 'product_aliases' && m.mutationType === 'insert').map((m) => m.recordPk)
  )
  const revertingProductImageIds = new Set(
    params.mutations.filter((m) => m.tableName === 'product_images' && m.mutationType === 'insert').map((m) => m.recordPk)
  )

  // Verify post-state integrity and external references for every mutated row (REV-07, REV-08)
  for (const m of params.mutations) {
    if (!['offers', 'products', 'product_aliases', 'product_images', 'offer_display_images'].includes(m.tableName)) {
      continue
    }
    if (m.reusedExisting) continue

    const curRes = await params.client.query<Record<string, any>>(
      `SELECT * FROM public.${m.tableName} WHERE id = $1 LIMIT 1`,
      [m.tableName === 'products' ? Number(m.recordPk) : m.recordPk]
    )

    if (m.mutationType === 'insert' || m.mutationType === 'update') {
      if (curRes.rows.length === 0) {
        blockedReasons.push(
          `CONCURRENT_MODIFICATION: ${m.tableName}(${m.recordPk}) was externally deleted after publish ${params.target.publishOperationId}.`
        )
        continue
      }
      if (m.postStateHash) {
        const curHash = computeRowStateHash(curRes.rows[0])
        // Ignore approved_primary_image_id self-update inside the same op when multiple mutations exist on same product row
        const latestOpMutForRow = [...params.mutations]
          .reverse()
          .find((cand) => cand.tableName === m.tableName && cand.recordPk === m.recordPk)
        if (latestOpMutForRow && latestOpMutForRow.id === m.id && curHash !== m.postStateHash) {
          blockedReasons.push(
            `CONCURRENT_POST_PUBLISH_EDIT: ${m.tableName}(${m.recordPk}) has been modified outside publish operation ${params.target.publishOperationId}.`
          )
        }
      }
    }

    if (m.tableName === 'offers' && m.mutationType === 'insert') {
      const savedRef = await params.client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM public.saved_offers WHERE offer_id = $1`,
        [m.recordPk]
      ).catch(() => ({ rows: [{ c: '0' }] }))
      if (parseInt(savedRef.rows[0]?.c || '0', 10) > 0) {
        blockedReasons.push(`EXTERNAL_DEPENDENCY: Offer ${m.recordPk} is saved/bookmarked by users in saved_offers.`)
      }

      const subMutRes = await params.client.query<{ publish_operation_id: string }>(
        `SELECT pjm.publish_operation_id
         FROM public.publication_journal_mutations pjm
         JOIN public.publication_operations po ON po.publish_operation_id = pjm.publish_operation_id
         WHERE pjm.table_name = 'offers'
           AND pjm.record_pk = $1
           AND pjm.publish_operation_id <> $2
           AND po.status = 'completed'
           AND po.completed_at > $3::timestamptz
         LIMIT 1`,
        [m.recordPk, params.target.publishOperationId, params.target.completedAt || params.target.startedAt]
      )
      if (subMutRes.rows.length > 0) {
        blockedReasons.push(
          `SUBSEQUENT_OPERATION_DEPENDENCY: Offer ${m.recordPk} was subsequently modified by operation ${subMutRes.rows[0].publish_operation_id}.`
        )
      }
    }

    if (m.tableName === 'products' && m.mutationType === 'insert' && deletingProductIds.has(m.recordPk)) {
      const prodNum = Number(m.recordPk)
      const extOffers = await params.client.query<{ id: string }>(
        `SELECT id::text FROM public.offers WHERE product_id = $1`,
        [prodNum]
      )
      const unownedOffer = extOffers.rows.find((r) => !revertingOfferIds.has(r.id))
      if (unownedOffer) {
        blockedReasons.push(
          `PRODUCT_REFERENCED_EXTERNALLY: Created product ${m.recordPk} is referenced by offer ${unownedOffer.id} outside this operation.`
        )
      }

      const extAliases = await params.client.query<{ id: string }>(
        `SELECT id::text FROM public.product_aliases WHERE product_id = $1`,
        [prodNum]
      )
      const unownedAlias = extAliases.rows.find((r) => !revertingAliasIds.has(r.id))
      if (unownedAlias) {
        blockedReasons.push(
          `PRODUCT_ALIAS_REFERENCED_EXTERNALLY: Created product ${m.recordPk} has external alias ${unownedAlias.id}.`
        )
      }

      const extProposals = await params.client.query<{ id: string }>(
        `SELECT id::text FROM public.product_alias_proposals WHERE proposed_product_id = $1 LIMIT 1`,
        [prodNum]
      ).catch(() => ({ rows: [] }))
      if (extProposals.rows.length > 0) {
        blockedReasons.push(
          `PRODUCT_PROPOSAL_DEPENDENCY: Created product ${m.recordPk} is linked in product_alias_proposals (${extProposals.rows[0].id}).`
        )
      }

      const extImages = await params.client.query<{ id: string }>(
        `SELECT id::text FROM public.product_images WHERE product_id = $1`,
        [prodNum]
      )
      const unownedImage = extImages.rows.find((r) => !revertingProductImageIds.has(r.id))
      if (unownedImage) {
        blockedReasons.push(
          `PRODUCT_IMAGE_DEPENDENCY: Created product ${m.recordPk} has external product_images record ${unownedImage.id}.`
        )
      }
    }
  }

  const reusedCount = params.mutations.filter((m) => m.reusedExisting).length
  if (reusedCount > 0) {
    warnings.push(`${reusedCount} reused catalog/storage record(s) will be preserved untouched.`)
  }

  return { blockedReasons, warnings }
}

async function applyMutationReversal(client: SqlQueryable, m: JournalMutationEntry): Promise<void> {
  if (m.reusedExisting) return

  if (m.mutationType === 'insert') {
    if (m.tableName === 'offers') {
      await client.query(`DELETE FROM public.offers WHERE id = $1`, [m.recordPk])
    } else if (m.tableName === 'products') {
      await client.query(`DELETE FROM public.products WHERE id = $1`, [Number(m.recordPk)])
    } else if (m.tableName === 'product_aliases') {
      await client.query(`DELETE FROM public.product_aliases WHERE id = $1`, [m.recordPk])
    } else if (m.tableName === 'product_images') {
      await client.query(`DELETE FROM public.product_images WHERE id = $1`, [m.recordPk])
    } else if (m.tableName === 'offer_display_images') {
      await client.query(`DELETE FROM public.offer_display_images WHERE id = $1`, [m.recordPk])
    } else if (m.tableName === 'offer_status_history') {
      await client.query(`DELETE FROM public.offer_status_history WHERE id = $1`, [m.recordPk])
    } else if (m.tableName === 'offer_revision_snapshots') {
      await client.query(`DELETE FROM public.offer_revision_snapshots WHERE id = $1`, [m.recordPk])
    }
    return
  }

  if (m.mutationType === 'update' && m.preState) {
    const pre = m.preState
    if (m.tableName === 'offers') {
      await client.query(
        `UPDATE public.offers SET
          supermarket_id = $2,
          city_id = $3,
          region_id = $4,
          product_id = $5,
          title_ar = $6,
          title_en = $7,
          offer_start_date = $8,
          offer_end_date = $9,
          offer_price = $10,
          original_price = $11,
          unit_price = $12,
          unit_price_unit = $13,
          status = $14,
          location_scope = $15,
          source_offer_id = $16,
          source_page_number = $17,
          source_item_number = $18,
          source_reference = $19,
          catalog_match_status = $20,
          catalog_verification_basis = $21,
          catalog_verified_by = $22,
          catalog_verified_at = $23,
          exact_identity_status = $24,
          assortment_status = $25,
          item_domain = $26,
          sale_unit_type = $27,
          inner_pack_count = $28,
          each_size_value = $29,
          each_size_unit = $30,
          total_content_value = $31,
          total_content_unit = $32,
          is_indivisible_sale_unit = $33,
          price_basis = $34,
          promo_mechanic = $35,
          bonus_wording = $36,
          loyalty_requirement = $37,
          is_loyalty_required = $38,
          quantity_limit = $39,
          quantity_limit_value = $40,
          image_url = $41,
          thumbnail_url = $42,
          image_subject_scope = $43,
          scoped_assessments = $44::jsonb,
          reason_codes = $45::text[],
          published_at = $46,
          source_document_id = $47,
          source_pdf_sha256 = $48,
          source_page_hash = $49,
          source_offer_anchor = $50,
          last_publish_operation_id = $51,
          updated_at = COALESCE($52::timestamptz, now())
         WHERE id = $1`,
        [
          m.recordPk,
          pre.supermarket_id,
          pre.city_id,
          pre.region_id,
          pre.product_id,
          pre.title_ar,
          pre.title_en,
          pre.offer_start_date,
          pre.offer_end_date,
          pre.offer_price,
          pre.original_price,
          pre.unit_price,
          pre.unit_price_unit,
          pre.status,
          pre.location_scope,
          pre.source_offer_id,
          pre.source_page_number,
          pre.source_item_number,
          pre.source_reference,
          pre.catalog_match_status,
          pre.catalog_verification_basis,
          pre.catalog_verified_by,
          pre.catalog_verified_at,
          pre.exact_identity_status,
          pre.assortment_status,
          pre.item_domain,
          pre.sale_unit_type,
          pre.inner_pack_count,
          pre.each_size_value,
          pre.each_size_unit,
          pre.total_content_value,
          pre.total_content_unit,
          pre.is_indivisible_sale_unit,
          pre.price_basis,
          pre.promo_mechanic,
          pre.bonus_wording,
          pre.loyalty_requirement,
          pre.is_loyalty_required,
          pre.quantity_limit,
          pre.quantity_limit_value,
          pre.image_url,
          pre.thumbnail_url,
          pre.image_subject_scope,
          pre.scoped_assessments != null ? JSON.stringify(pre.scoped_assessments) : null,
          pre.reason_codes ?? null,
          pre.published_at,
          pre.source_document_id ?? null,
          pre.source_pdf_sha256 ?? null,
          pre.source_page_hash ?? null,
          pre.source_offer_anchor ?? null,
          pre.last_publish_operation_id ?? null,
          pre.updated_at ?? null
        ]
      )
    } else if (m.tableName === 'products') {
      await client.query(
        `UPDATE public.products SET
          approved_primary_image_id = $2,
          default_image_url = $3,
          verification_status = COALESCE($4, verification_status),
          updated_at = COALESCE($5::timestamptz, now())
         WHERE id = $1`,
        [
          Number(m.recordPk),
          pre.approved_primary_image_id ?? null,
          pre.default_image_url ?? null,
          pre.verification_status ?? null,
          pre.updated_at ?? null
        ]
      )
    } else if (m.tableName === 'product_images') {
      await client.query(
        `UPDATE public.product_images SET
          public_url = $2,
          storage_object_path = $3,
          content_sha256 = $4,
          approval_status = COALESCE($5, 'approved'),
          role = COALESCE($6, 'primary'),
          updated_at = COALESCE($7::timestamptz, now())
         WHERE id = $1`,
        [
          m.recordPk,
          pre.public_url,
          pre.storage_object_path,
          pre.content_sha256,
          pre.approval_status,
          pre.role,
          pre.updated_at ?? null
        ]
      )
    } else if (m.tableName === 'offer_display_images') {
      await client.query(
        `UPDATE public.offer_display_images SET
          public_url = $2,
          storage_object_path = $3,
          content_sha256 = $4,
          approval_status = COALESCE($5, 'approved'),
          updated_at = COALESCE($6::timestamptz, now())
         WHERE id = $1`,
        [
          m.recordPk,
          pre.public_url,
          pre.storage_object_path,
          pre.content_sha256,
          pre.approval_status,
          pre.updated_at ?? null
        ]
      )
    }
  }
}

export async function previewUndoLastPublish(params: {
  client: SqlQueryable
  publishOperationId?: string | null
}): Promise<UndoPreviewResult> {
  const { target, alreadyUndone, blockedReasons } = await resolveLatestUndoTarget(
    params.client,
    params.publishOperationId
  )
  if (!target) {
    return {
      canUndo: false,
      targetOperation: null,
      alreadyUndone,
      blockedReasons,
      warnings: [],
      affectedCounts: {
        offersToDelete: 0,
        offersToRestore: 0,
        productsToDelete: 0,
        productsReusedPreserved: 0,
        aliasesToDelete: 0,
        imagesToDelete: 0,
        exclusiveStorageObjectsToDelete: 0,
        reusedStorageObjectsPreserved: 0
      },
      sampleChanges: []
    }
  }

  const details = await getPublicationOperationDetails({
    client: params.client,
    publishOperationId: target.publishOperationId
  })

  const depCheck =
    blockedReasons.length === 0
      ? await checkUndoConflictsAndDependencies({
          client: params.client,
          target,
          mutations: details.mutations
        })
      : { blockedReasons: [], warnings: [] }

  const allBlocked = [...blockedReasons, ...depCheck.blockedReasons]

  const exclusiveStorageObjectsToDelete = details.storageOperations.filter(
    (s) => s.ownership_mode === 'exclusive_created' && s.storage_state === 'committed'
  ).length
  const reusedStorageObjectsPreserved = details.storageOperations.filter(
    (s) => s.ownership_mode === 'reused_existing'
  ).length

  const offersToDelete = details.mutations.filter(
    (m) => m.tableName === 'offers' && m.mutationType === 'insert'
  ).length
  const offersToRestore = details.mutations.filter(
    (m) => m.tableName === 'offers' && m.mutationType === 'update'
  ).length
  const productsToDelete = details.mutations.filter(
    (m) => m.tableName === 'products' && m.mutationType === 'insert' && !m.reusedExisting
  ).length
  const productsReusedPreserved =
    details.mutations.filter((m) => m.tableName === 'products' && m.reusedExisting).length +
    target.reusedProductsCount
  const aliasesToDelete = details.mutations.filter(
    (m) => m.tableName === 'product_aliases' && m.mutationType === 'insert'
  ).length
  const imagesToDelete = details.mutations.filter(
    (m) =>
      (m.tableName === 'product_images' || m.tableName === 'offer_display_images') &&
      m.mutationType === 'insert'
  ).length

  const sampleChanges = details.mutations
    .filter((m) => !m.reusedExisting && ['offers', 'products', 'product_aliases', 'product_images', 'offer_display_images'].includes(m.tableName))
    .slice(0, 25)
    .map((m) => ({
      tableName: m.tableName,
      recordPk: m.recordPk,
      action: m.mutationType === 'insert' ? 'delete_inserted_row' : 'restore_pre_state',
      label:
        m.postState?.title_en ||
        m.postState?.name_en ||
        m.postState?.alias_text ||
        m.postState?.source_offer_id ||
        m.recordPk
    }))

  return {
    canUndo: allBlocked.length === 0 && !alreadyUndone,
    targetOperation: target,
    alreadyUndone,
    blockedReasons: allBlocked,
    warnings: depCheck.warnings,
    affectedCounts: {
      offersToDelete,
      offersToRestore,
      productsToDelete,
      productsReusedPreserved,
      aliasesToDelete,
      imagesToDelete,
      exclusiveStorageObjectsToDelete,
      reusedStorageObjectsPreserved
    },
    sampleChanges
  }
}

export async function undoLastPublish(params: {
  client: SqlQueryable
  operatorId: string
  reason: string
  publishOperationId?: string | null
  storageAdapter?: StorageLifecycleAdapter | null
}): Promise<UndoExecutionResult> {
  const operatorId = (params.operatorId || '').trim() || 'operator'
  const reason = (params.reason || '').trim()
  if (!reason) {
    return {
      success: false,
      status: 'undo_blocked',
      targetOperationId: params.publishOperationId || null,
      undoAuditOperationId: null,
      blockedReasons: ['UNDO_REASON_REQUIRED: Operator must provide a clear reason to undo a publication.'],
      revertedMutationsCount: 0,
      storageCleanup: { deletedCount: 0, skippedReferencedCount: 0, failedCount: 0, errors: [] },
      message: 'Undo blocked: reason is required.'
    }
  }

  let targetOpIdForLock: string | null = params.publishOperationId || null
  let undoAuditId: string | null = null
  let revertedCount = 0

  await params.client.query('BEGIN')
  try {
    // Global undo & publication mutex lock (REV-11)
    await params.client.query(`SELECT pg_advisory_xact_lock(hashtext('wifran:publication_global_mutex'))`)
    await params.client.query(`SET LOCAL wifran.suppress_journal_trigger = 'true'`)

    const { target, alreadyUndone, blockedReasons } = await resolveLatestUndoTarget(
      params.client,
      params.publishOperationId
    )
    if (!target) {
      await params.client.query('ROLLBACK')
      return {
        success: false,
        alreadyUndone,
        status: 'not_found',
        targetOperationId: null,
        undoAuditOperationId: null,
        blockedReasons,
        revertedMutationsCount: 0,
        storageCleanup: { deletedCount: 0, skippedReferencedCount: 0, failedCount: 0, errors: [] },
        message: blockedReasons[0] || 'No undo-eligible publication operation found.'
      }
    }

    targetOpIdForLock = target.publishOperationId
    if (alreadyUndone) {
      await params.client.query('ROLLBACK')
      return {
        success: true,
        alreadyUndone: true,
        status: target.status,
        targetOperationId: target.publishOperationId,
        undoAuditOperationId: target.undoneByOperationId || null,
        blockedReasons: [],
        revertedMutationsCount: 0,
        storageCleanup: { deletedCount: 0, skippedReferencedCount: 0, failedCount: 0, errors: [] },
        message: `Publication ${target.publishOperationId} was already undone cleanly.`
      }
    }

    const details = await getPublicationOperationDetails({
      client: params.client,
      publishOperationId: target.publishOperationId
    })

    const depCheck = await checkUndoConflictsAndDependencies({
      client: params.client,
      target,
      mutations: details.mutations
    })

    const allBlocked = [...blockedReasons, ...depCheck.blockedReasons]
    if (allBlocked.length > 0) {
      await params.client.query(
        `UPDATE public.publication_operations
         SET undo_blocked_reason = $2,
             updated_at = now()
         WHERE publish_operation_id = $1`,
        [target.publishOperationId, allBlocked.join(' | ')]
      )
      await params.client.query('COMMIT')
      return {
        success: false,
        status: 'undo_blocked',
        targetOperationId: target.publishOperationId,
        undoAuditOperationId: null,
        blockedReasons: allBlocked,
        revertedMutationsCount: 0,
        storageCleanup: { deletedCount: 0, skippedReferencedCount: 0, failedCount: 0, errors: [] },
        message: `Undo blocked: ${allBlocked.join(' | ')}`
      }
    }

    await params.client.query(
      `UPDATE public.publication_operations
       SET status = 'undo_in_progress',
           undo_requested_by = $2,
           undo_reason = $3,
           updated_at = now()
       WHERE publish_operation_id = $1`,
      [target.publishOperationId, operatorId, reason]
    )

    // Execute exact reverse sequence order inside the single transaction
    const reverseMutations = [...details.mutations].sort((a, b) => b.sequenceNo - a.sequenceNo)
    for (const mut of reverseMutations) {
      await applyMutationReversal(params.client, mut)
      if (!mut.reusedExisting) {
        revertedCount++
      }
    }

    // Record permanent audit entry for this Undo action itself (REV-14)
    undoAuditId = crypto.randomUUID()
    await params.client.query(
      `INSERT INTO public.publication_operations (
        publish_operation_id,
        idempotency_key,
        payload_fingerprint,
        target_project_ref,
        environment_context,
        batch_id,
        source_document_ids,
        operator_id,
        status,
        requested_offers_count,
        inserted_offers_count,
        updated_offers_count,
        undo_eligible,
        undo_target_operation_id,
        undo_requested_by,
        undo_reason,
        started_at,
        completed_at,
        undone_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'undone', $9, 0, 0, false, $10, $8, $11, now(), now(), now())`,
      [
        undoAuditId,
        `undo:${target.publishOperationId}:${undoAuditId}`,
        computePublishPayloadFingerprint({ undoTarget: target.publishOperationId, reason }),
        target.targetProjectRef,
        target.environmentContext,
        target.batchId,
        JSON.stringify(target.sourceDocumentIds),
        operatorId,
        revertedCount,
        target.publishOperationId,
        reason
      ]
    )

    await params.client.query(
      `UPDATE public.publication_operations
       SET status = 'undone',
           undo_eligible = false,
           undo_blocked_reason = NULL,
           undone_by_operation_id = $2,
           undo_requested_by = $3,
           undo_reason = $4,
           undone_at = now(),
           updated_at = now()
       WHERE publish_operation_id = $1`,
      [target.publishOperationId, undoAuditId, operatorId, reason]
    )

    await params.client.query('COMMIT')
  } catch (err: any) {
    await params.client.query('ROLLBACK').catch(() => {})
    if (targetOpIdForLock) {
      await params.client
        .query(
          `UPDATE public.publication_operations
           SET error_diagnostics = COALESCE(error_diagnostics, '{}'::jsonb) || $2::jsonb,
               updated_at = now()
           WHERE publish_operation_id = $1`,
          [
            targetOpIdForLock,
            JSON.stringify({ lastUndoFailure: err?.message || String(err), at: new Date().toISOString() })
          ]
        )
        .catch(() => {})
    }
    throw new Error(`UNDO_LAST_PUBLISH_FAILED: ${err?.message || String(err)}`)
  }

  // Post-DB-commit storage cleanup (STORAGE-03, STORAGE-04, REV-12)
  const storageCleanup = await cleanupExclusiveStorageForUndoneOperation({
    client: params.client,
    publishOperationId: targetOpIdForLock!,
    adapter: params.storageAdapter
  })

  let finalStatus: PublicationOperationStatus = 'undone'
  if (storageCleanup.failedCount > 0) {
    finalStatus = 'undo_cleanup_pending'
    await params.client.query(
      `UPDATE public.publication_operations
       SET status = 'undo_cleanup_pending',
           error_diagnostics = COALESCE(error_diagnostics, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE publish_operation_id = $1`,
      [
        targetOpIdForLock,
        JSON.stringify({
          pendingStorageCleanupErrors: storageCleanup.errors,
          updatedAt: new Date().toISOString()
        })
      ]
    )
  }

  return {
    success: true,
    status: finalStatus,
    targetOperationId: targetOpIdForLock,
    undoAuditOperationId: undoAuditId,
    blockedReasons: [],
    revertedMutationsCount: revertedCount,
    storageCleanup,
    message:
      storageCleanup.failedCount > 0
        ? `Database changes reverted (${revertedCount} mutations), but ${storageCleanup.failedCount} storage object(s) remain pending cleanup.`
        : `Successfully undid publication ${targetOpIdForLock} (${revertedCount} mutations reverted, ${storageCleanup.deletedCount} exclusive storage object(s) deleted).`
  }
}

export async function retryUndoStorageCleanup(params: {
  client: SqlQueryable
  publishOperationId: string
  storageAdapter?: StorageLifecycleAdapter | null
}): Promise<{
  success: boolean
  status: PublicationOperationStatus
  storageCleanup: {
    deletedCount: number
    skippedReferencedCount: number
    failedCount: number
    errors: string[]
  }
}> {
  const storageCleanup = await cleanupExclusiveStorageForUndoneOperation({
    client: params.client,
    publishOperationId: params.publishOperationId,
    adapter: params.storageAdapter
  })
  const nextStatus: PublicationOperationStatus =
    storageCleanup.failedCount === 0 ? 'undone' : 'undo_cleanup_pending'
  await params.client.query(
    `UPDATE public.publication_operations
     SET status = $2,
         error_diagnostics = CASE
           WHEN $2 = 'undone' THEN COALESCE(error_diagnostics, '{}'::jsonb) - 'pendingStorageCleanupErrors'
           ELSE COALESCE(error_diagnostics, '{}'::jsonb) || $3::jsonb
         END,
         updated_at = now()
     WHERE publish_operation_id = $1
       AND status IN ('undo_cleanup_pending', 'undone')`,
    [
      params.publishOperationId,
      nextStatus,
      JSON.stringify({ pendingStorageCleanupErrors: storageCleanup.errors })
    ]
  )
  return {
    success: storageCleanup.failedCount === 0,
    status: nextStatus,
    storageCleanup
  }
}
