/**
 * Staged Content-Addressed Storage Lifecycle Service
 * Milestone: WIFRAN-EXTRACTOR-IDENTITY-005J-UAT-FIX-08 (STORAGE-01..04)
 *
 * Ensures:
 * - Storage client strictly matches the selected DatabaseContext (zero cross-DB storage leakage).
 * - Objects are content-addressed by SHA-256 and reused when identical bytes already exist.
 * - Exclusive newly uploaded objects are tracked in public.publication_storage_operations.
 * - Undo cleanup ONLY deletes exclusive objects no longer referenced by any active DB row.
 */

import fs from 'fs'
import crypto from 'crypto'
import { getGuardedSupabaseClient, type DatabaseContext } from '../db/databaseEnvironmentResolver'
import type { SqlQueryable } from '../db/schemaCompatibilityService'

export interface StorageLifecycleAdapter {
  bucketExists?: (bucket: string) => Promise<boolean>
  getBucketVisibility?: (bucket: string) => Promise<boolean | null>
  objectExists: (bucket: string, objectPath: string) => Promise<boolean>
  uploadObject: (params: {
    bucket: string
    objectPath: string
    buffer: Buffer
    contentType: string
  }) => Promise<{ error?: string | null }>
  deleteObjects: (bucket: string, objectPaths: string[]) => Promise<{ error?: string | null }>
  getPublicUrl: (bucket: string, objectPath: string) => string
}

export interface StagedUploadOutcome {
  bucket: string
  objectPath: string
  contentSha256: string
  publicUrl: string
  ownershipMode: 'exclusive_created' | 'reused_existing'
  storageState: 'staged' | 'committed'
  byteSize?: number
  contentType?: string
}

export function createGuardedStorageAdapter(context: DatabaseContext): StorageLifecycleAdapter {
  const supabase = getGuardedSupabaseClient(context)
  return {
    bucketExists: async (bucket: string) => {
      const { data, error } = await supabase.storage.getBucket(bucket)
      return Boolean(data && !error)
    },
    getBucketVisibility: async (bucket: string) => {
      const { data, error } = await supabase.storage.getBucket(bucket)
      if (error || !data) return null
      return typeof data.public === 'boolean' ? data.public : null
    },
    objectExists: async (bucket: string, objectPath: string) => {
      const clean = objectPath.replace(/^\/+/, '')
      const idx = clean.lastIndexOf('/')
      const folder = idx >= 0 ? clean.slice(0, idx) : ''
      const fileName = idx >= 0 ? clean.slice(idx + 1) : clean
      const { data, error } = await supabase.storage.from(bucket).list(folder, {
        limit: 5,
        search: fileName
      })
      if (error || !Array.isArray(data)) return false
      return data.some((entry) => entry.name === fileName)
    },
    uploadObject: async ({ bucket, objectPath, buffer, contentType }) => {
      const clean = objectPath.replace(/^\/+/, '')
      const { error } = await supabase.storage.from(bucket).upload(clean, buffer, {
        contentType,
        upsert: false
      })
      if (error && /already exists|duplicate/i.test(error.message || '')) {
        return { error: null }
      }
      return { error: error ? error.message : null }
    },
    deleteObjects: async (bucket: string, objectPaths: string[]) => {
      if (objectPaths.length === 0) return { error: null }
      const { error } = await supabase.storage.from(bucket).remove(objectPaths)
      return { error: error ? error.message : null }
    },
    getPublicUrl: (bucket: string, objectPath: string) => {
      const clean = objectPath.replace(/^\/+/, '')
      const { data } = supabase.storage.from(bucket).getPublicUrl(clean)
      return data?.publicUrl || `${bucket}/${clean}`
    }
  }
}

const DEFAULT_IN_MEMORY_BUCKET_VISIBILITY: Record<string, boolean> = {
  'offer-images': false,
  tmp: false,
  'product-images': true,
  'offer-display-images': true
}

export function createInMemoryStorageAdapter(
  baseUrl = 'https://isolated-test.storage.local',
  bucketVisibilityOverrides?: Record<string, boolean | null>
): StorageLifecycleAdapter & {
  storedObjects: Map<string, { buffer: Buffer; contentType: string }>
} {
  const storedObjects = new Map<string, { buffer: Buffer; contentType: string }>()
  return {
    storedObjects,
    bucketExists: async (bucket) => {
      if (bucketVisibilityOverrides && Object.prototype.hasOwnProperty.call(bucketVisibilityOverrides, bucket)) {
        return bucketVisibilityOverrides[bucket] !== null
      }
      return true
    },
    getBucketVisibility: async (bucket) => {
      if (bucketVisibilityOverrides && Object.prototype.hasOwnProperty.call(bucketVisibilityOverrides, bucket)) {
        return bucketVisibilityOverrides[bucket] ?? null
      }
      return Object.prototype.hasOwnProperty.call(DEFAULT_IN_MEMORY_BUCKET_VISIBILITY, bucket)
        ? DEFAULT_IN_MEMORY_BUCKET_VISIBILITY[bucket]
        : null
    },
    objectExists: async (bucket, objectPath) =>
      storedObjects.has(`${bucket}/${objectPath.replace(/^\/+/, '')}`),
    uploadObject: async ({ bucket, objectPath, buffer, contentType }) => {
      const key = `${bucket}/${objectPath.replace(/^\/+/, '')}`
      storedObjects.set(key, { buffer: Buffer.from(buffer), contentType })
      return { error: null }
    },
    deleteObjects: async (bucket, objectPaths) => {
      for (const p of objectPaths) {
        storedObjects.delete(`${bucket}/${p.replace(/^\/+/, '')}`)
      }
      return { error: null }
    },
    getPublicUrl: (bucket, objectPath) =>
      `${baseUrl}/${bucket}/${objectPath.replace(/^\/+/, '')}`
  }
}

export function buildContentAddressedStoragePath(params: {
  scopePrefix: 'offers' | 'products'
  contentSha256: string
  extension?: string
}): string {
  const ext = (params.extension || 'webp').replace(/^\./, '').toLowerCase()
  const digest = params.contentSha256.toLowerCase()
  return `${params.scopePrefix}/sha256/${digest.slice(0, 2)}/${digest}.${ext}`
}

export async function stageContentAddressedUpload(params: {
  adapter: StorageLifecycleAdapter
  bucket: string
  localFilePath?: string | null
  buffer?: Buffer | null
  scopePrefix: 'offers' | 'products'
  extension?: string
  contentType?: string
}): Promise<StagedUploadOutcome | null> {
  let buf: Buffer | null = params.buffer || null
  if (!buf && params.localFilePath) {
    if (!fs.existsSync(params.localFilePath)) return null
    buf = fs.readFileSync(params.localFilePath)
  }
  if (!buf || buf.length === 0) return null

  const contentSha256 = crypto.createHash('sha256').update(buf).digest('hex')
  const ext = params.extension || (params.localFilePath?.split('.').pop() || 'webp')
  const objectPath = buildContentAddressedStoragePath({
    scopePrefix: params.scopePrefix,
    contentSha256,
    extension: ext
  })
  const contentType =
    params.contentType ||
    (ext.toLowerCase() === 'png'
      ? 'image/png'
      : ext.toLowerCase() === 'jpg' || ext.toLowerCase() === 'jpeg'
        ? 'image/jpeg'
        : 'image/webp')

  const alreadyExists = await params.adapter.objectExists(params.bucket, objectPath)
  if (alreadyExists) {
    return {
      bucket: params.bucket,
      objectPath,
      contentSha256,
      publicUrl: params.adapter.getPublicUrl(params.bucket, objectPath),
      ownershipMode: 'reused_existing',
      storageState: 'staged',
      byteSize: buf.length,
      contentType
    }
  }

  const uploadRes = await params.adapter.uploadObject({
    bucket: params.bucket,
    objectPath,
    buffer: buf,
    contentType
  })
  if (uploadRes.error) {
    throw new Error(`STORAGE_STAGED_UPLOAD_FAILED: ${uploadRes.error}`)
  }

  return {
    bucket: params.bucket,
    objectPath,
    contentSha256,
    publicUrl: params.adapter.getPublicUrl(params.bucket, objectPath),
    ownershipMode: 'exclusive_created',
    storageState: 'staged',
    byteSize: buf.length,
    contentType
  }
}

/**
 * Deletes orphaned exclusive objects belonging to an undone publication operation ONLY after
 * verifying zero remaining DB references in product_images, offer_display_images, or other
 * active publication_storage_operations rows.
 */
export async function cleanupExclusiveStorageForUndoneOperation(params: {
  client: SqlQueryable
  publishOperationId: string
  adapter?: StorageLifecycleAdapter | null
}): Promise<{
  deletedCount: number
  skippedReferencedCount: number
  failedCount: number
  errors: string[]
}> {
  const opsRes = await params.client.query<{
    id: string
    bucket: string
    object_path: string
    content_sha256: string | null
    ownership_mode: string
    storage_state: string
  }>(
    `SELECT id, bucket, object_path, content_sha256, ownership_mode, storage_state
     FROM public.publication_storage_operations
     WHERE publish_operation_id = $1
       AND ownership_mode = 'exclusive_created'
       AND storage_state IN ('committed', 'cleanup_pending', 'cleanup_failed')`,
    [params.publishOperationId]
  )

  let deletedCount = 0
  let skippedReferencedCount = 0
  let failedCount = 0
  const errors: string[] = []

  for (const row of opsRes.rows) {
    // Safety verification: never delete if still referenced anywhere active
    const refCheck = await params.client.query<{ ref_count: string }>(
      `SELECT (
         (SELECT count(*) FROM public.publication_storage_operations pso
          JOIN public.publication_operations po ON po.publish_operation_id = pso.publish_operation_id
          WHERE pso.bucket = $1 AND pso.object_path = $2
            AND pso.publish_operation_id <> $3
            AND pso.storage_state = 'committed'
            AND po.status = 'completed') +
         (SELECT count(*) FROM public.offer_display_images odi
          WHERE odi.storage_object_path = $2 AND odi.approval_status = 'approved') +
         (SELECT count(*) FROM public.product_images pi
          WHERE pi.storage_object_path = $2 AND pi.approval_status = 'approved')
       )::text AS ref_count`,
      [row.bucket, row.object_path, params.publishOperationId]
    )

    const refCount = parseInt(refCheck.rows[0]?.ref_count || '0', 10)
    if (refCount > 0) {
      await params.client.query(
        `UPDATE public.publication_storage_operations
         SET storage_state = 'cleanup_skipped_referenced',
             updated_at = now()
         WHERE id = $1`,
        [row.id]
      )
      skippedReferencedCount++
      continue
    }

    if (!params.adapter) {
      await params.client.query(
        `UPDATE public.publication_storage_operations
         SET storage_state = 'cleanup_pending',
             cleanup_error = 'Storage adapter unavailable for cleanup.',
             updated_at = now()
         WHERE id = $1`,
        [row.id]
      )
      failedCount++
      errors.push(`Storage adapter missing for ${row.bucket}/${row.object_path}`)
      continue
    }

    const delRes = await params.adapter.deleteObjects(row.bucket, [row.object_path])
    if (delRes.error) {
      await params.client.query(
        `UPDATE public.publication_storage_operations
         SET storage_state = 'cleanup_failed',
             cleanup_error = $2,
             updated_at = now()
         WHERE id = $1`,
        [row.id, delRes.error]
      )
      failedCount++
      errors.push(`${row.bucket}/${row.object_path}: ${delRes.error}`)
    } else {
      await params.client.query(
        `UPDATE public.publication_storage_operations
         SET storage_state = 'cleaned_up',
             cleanup_error = NULL,
             updated_at = now()
         WHERE id = $1`,
        [row.id]
      )
      deletedCount++
    }
  }

  return { deletedCount, skippedReferencedCount, failedCount, errors }
}
