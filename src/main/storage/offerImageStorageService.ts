import fs from 'fs'
import { getSupabaseAdminClient } from '../db/supabaseAdminClient'

export async function uploadOfferImage(input: {
  localImagePath: string
  storageBucket: string
  storagePath: string
  contentType: string
}): Promise<{
  imageUrl: string
  storagePath: string
}> {
  if (!fs.existsSync(input.localImagePath)) {
    throw new Error(`Local file not found: ${input.localImagePath}`)
  }

  const fileBuffer = fs.readFileSync(input.localImagePath)
  const supabase = getSupabaseAdminClient()

  const { error } = await supabase.storage
    .from(input.storageBucket)
    .upload(input.storagePath, fileBuffer, {
      contentType: input.contentType,
      upsert: true // Deterministic paths so we can overwrite safely on retry
    })

  if (error) {
    console.error('Supabase Storage upload error:', error)
    throw new Error(`STORAGE_UPLOAD_FAILED: ${error.message}`)
  }

  // Wifran uses public URLs
  const { data: publicUrlData } = supabase.storage
    .from(input.storageBucket)
    .getPublicUrl(input.storagePath)

  return {
    imageUrl: publicUrlData.publicUrl,
    storagePath: input.storagePath
  }
}
