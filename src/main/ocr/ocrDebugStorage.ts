import { join } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { getSafeConfigStatus } from '../config/configStatus'

export function stripLargeOcrPayloadFields(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => stripLargeOcrPayloadFields(item))
  }
  
  const stripped: any = {}
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (key === 'image_base64' || key === 'base64' || (typeof obj[key] === 'string' && obj[key].length > 50000 && key !== 'document_annotation')) {
        stripped[key] = '[REDACTED_LARGE_PAYLOAD]'
      } else {
        stripped[key] = stripLargeOcrPayloadFields(obj[key])
      }
    }
  }
  return stripped
}

export async function saveOcrDebugData(
  workspacePath: string | undefined,
  chunkId: string,
  rawResponse: unknown,
  documentAnnotation: unknown,
  normalizedRows: unknown[]
): Promise<string | null> {
  if (!workspacePath) return null

  const config = getSafeConfigStatus()
  if (!config.debug.saveIntermediateFiles) {
    return null
  }

  try {
    const debugDir = join(workspacePath, 'ocr')
    await mkdir(debugDir, { recursive: true })

    const strippedRawResponse = stripLargeOcrPayloadFields(rawResponse)

    await writeFile(
      join(debugDir, `${chunkId}-raw-response.json`),
      JSON.stringify(strippedRawResponse, null, 2),
      'utf-8'
    )

    await writeFile(
      join(debugDir, `${chunkId}-document-annotation.json`),
      JSON.stringify(documentAnnotation, null, 2),
      'utf-8'
    )

    await writeFile(
      join(debugDir, `${chunkId}-normalized-rows.json`),
      JSON.stringify(normalizedRows, null, 2),
      'utf-8'
    )

    return debugDir
  } catch (e) {
    console.error(`[ocrDebugStorage] Failed to save debug files for ${chunkId}`, e)
    return null
  }
}
