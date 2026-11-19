import { readFile } from 'fs/promises'
import { getGuardedSupabaseClient, type DatabaseContext } from '../db/databaseEnvironmentResolver'
import { info, error as logError } from '../logging/logger'

export interface UploadOfferImageInput {
  localFilePath?: string
  localImagePath?: string
  bucket?: string
  storageBucket?: string
  storagePath: string
  contentType?: string
  databaseContext?: DatabaseContext
}

export async function uploadOfferImage(
  input: UploadOfferImageInput
): Promise<{ imageUrl: string; publicUrl?: string; storagePath: string }> {
  const context: DatabaseContext = input.databaseContext || 'PRODUCTION_UI'
  const localPath = input.localFilePath || input.localImagePath
  const bucketName = input.bucket || input.storageBucket
  if (!localPath || !bucketName) {
    throw new Error('uploadOfferImage requires localFilePath/localImagePath and bucket/storageBucket.')
  }
  const supabase = getGuardedSupabaseClient(context)
  const fileBuffer = await readFile(localPath)

  const cleanStoragePath = input.storagePath.replace(/^\/+/, '')
  const contentType = input.contentType || 'image/webp'

  info(
    `Uploading offer image (${context}) to bucket "${bucketName}" at "${cleanStoragePath}"...`
  )

  const { error } = await supabase.storage
    .from(bucketName)
    .upload(cleanStoragePath, fileBuffer, {
      contentType,
      upsert: false
    })

  if (error && !/already exists|duplicate/i.test(error.message || '')) {
    logError(`Supabase storage upload error (${context}): ${error.message}`)
    throw new Error(`Storage upload failed: ${error.message}`)
  }

  const { data: publicUrlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(cleanStoragePath)

  return {
    imageUrl: publicUrlData.publicUrl,
    publicUrl: publicUrlData.publicUrl,
    storagePath: cleanStoragePath
  }
}
