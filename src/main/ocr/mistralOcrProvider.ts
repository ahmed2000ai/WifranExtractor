import { readFileSync } from 'fs'
import path from 'path'
import { loadEnvConfig } from '../config/env'
import { normalizeOcrExtractionResponse } from '../../shared/utils/ocrNormalization'
import { saveOcrDebugData } from './ocrDebugStorage'
import {
  buildWifranCropExtractionPrompt,
  buildWifranCropAnnotationFormat,
  buildWifranFullPageExtractionPrompt,
  buildWifranFullPageAnnotationFormat
} from './ocrPromptBuilder'
import type { OcrChunkInput, OcrExtractedDocument, OcrProvider } from './ocrTypes'
import sharp from 'sharp'
import { runWithMistralRateLimit, MistralRequestKind } from './mistralRateLimitQueue'
import { getMistralClient } from './mistralClient'

// Free-tier safe delay between API calls (in ms)


/**
 * Helper to call Mistral Chat (Pixtral) with an image and prompt.
 * Handles rate limiting with exponential backoff for free-tier safety.
 */
async function callPixtralVision(opts: {
  apiKey: string
  imageDataUrl: string
  promptText: string
  schema: unknown
  maxRetries?: number
  kind?: MistralRequestKind
  pageNumber?: number
}): Promise<{ parsed: any; usage: any } | null> {
  const { apiKey, imageDataUrl, promptText, schema, kind = 'document_ocr', pageNumber } = opts

  let chatRes: Response | null = null

  try {
    chatRes = await runWithMistralRateLimit(
      { kind, label: 'Pixtral Vision Call', pageNumber },
      async () => {
        const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json; charset=utf-8'
          },
          body: JSON.stringify({
            model: 'mistral-large-2512',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: promptText + '\n\nEXPECTED JSON SCHEMA:\n' + JSON.stringify(schema, null, 2) },
                  { type: 'image_url', image_url: { url: imageDataUrl } }
                ]
              }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1
          })
        })

        if (res.status === 429) {
          const errText = await res.text()
          const err: any = new Error('Mistral 429 Rate Limit')
          err.status = 429
          err.statusCode = 429
          err.body = errText
          err.headers = res.headers
          err.retryAfter = res.headers?.get('retry-after')
          throw err
        }

        if (!res.ok) {
          const errText = await res.text()
          const err: any = new Error(`Chat API failed: ${errText}`)
          err.status = res.status
          throw err
        }

        return res
      }
    )
  } catch (err: any) {
    console.error(`callPixtralVision failed:`, err.message)
    return null
  }

  if (!chatRes || !chatRes.ok) return null

  try {
    const chatJson = await chatRes.json()
    const content = chatJson.choices?.[0]?.message?.content
    const usage = chatJson.usage
    if (content) {
      const parsed = typeof content === 'string' ? JSON.parse(content) : content
      return { parsed, usage }
    }
  } catch (e: any) {
    console.error('Failed to parse Pixtral response:', e)
  }

  return null
}

export class MistralOcrProvider implements OcrProvider {
  async extractOffersFromChunk(input: OcrChunkInput): Promise<OcrExtractedDocument> {
    const rawConfig = loadEnvConfig()
    const apiKey = process.env.MISTRAL_API_KEY || rawConfig.mistral.apiKey
    
    if (!apiKey) {
      throw new Error('MISSING_MISTRAL_API_KEY: Mistral API key is not configured.')
    }

    const activeClient = await getMistralClient(apiKey)

    // Read local PDF file
    let pdfBuffer: Buffer
    try {
      pdfBuffer = readFileSync(input.chunkPdfPath)
    } catch (e: any) {
      throw new Error(`OCR_FILE_READ_ERROR: Could not read chunk PDF from ${input.chunkPdfPath}`)
    }

    // 1. Run Mistral OCR strictly for layout (gets markdown + image regions)
    let response: any
    try {
      response = await runWithMistralRateLimit(
        { kind: 'document_ocr', label: 'Mistral Layout OCR', pageNumber: input.originalPageNumbers[0] },
        async () => {
          // Upload local file with purpose: "ocr"
          const uploadedFile = await activeClient.files.upload({
            file: {
              fileName: path.basename(input.chunkPdfPath),
              content: pdfBuffer
            },
            purpose: 'ocr'
          })

          if (!uploadedFile?.id) {
            throw new Error('OCR_UPLOAD_FAILED: Failed to upload file to Mistral for OCR.')
          }

          // Pass the returned id as a file_id type object into client.ocr.process
          return await activeClient.ocr.process({
            model: rawConfig.mistral.ocrModel || 'mistral-ocr-latest',
            document: {
              type: 'file',
              fileId: uploadedFile.id
            },
            includeImageBase64: false
          })
        }
      )
    } catch (e: any) {
      console.error('[MistralOcrProvider] Mistral API call failed:', e)
      throw new Error(`OCR_API_ERROR: Mistral request failed: ${e.message}`)
    }

    console.log('[DEBUG] Mistral OCR Layout Response retrieved.')
    
    // Wait after OCR layout call before starting vision calls
    // (Handled by mistralRateLimitQueue)

    const parsedAnnotation: any = { items: [] }
    let globalRowId = 1
    let promptTokens = 0
    let completionTokens = 0

    // ═══════════════════════════════════════════════════════════════
    // PASS 1: FULL-PAGE VISION — Send entire rendered page to Pixtral
    // This is the PRIMARY extraction pass that catches ALL products
    // ═══════════════════════════════════════════════════════════════

    if (response.pages && response.pages.length > 0) {
      for (const p of response.pages) {
        const expectedPage = input.originalPageNumbers[p.index] || (p.index + 1)
        const renderedPage = input.renderedPages.find(rp => rp.pageNumber === expectedPage) || input.renderedPages[0]

        if (!renderedPage) continue

        console.log(`[Pass 1] Full-page vision extraction for page ${expectedPage}...`)

        // Read the full page image and send to Pixtral
        let pageBuffer: Buffer
        try {
          pageBuffer = await sharp(renderedPage.imagePath)
            .jpeg({ quality: 90 })
            .toBuffer()
        } catch (e: any) {
          console.error(`Failed to read page image for page ${expectedPage}:`, e)
          continue
        }

        const pageDataUrl = `data:image/jpeg;base64,${pageBuffer.toString('base64')}`
        
        // Throttle before API call — free-tier safe delay
        // (Handled by mistralRateLimitQueue)

        const fullPageResult = await callPixtralVision({
          apiKey,
          imageDataUrl: pageDataUrl,
          promptText: buildWifranFullPageExtractionPrompt(),
          schema: buildWifranFullPageAnnotationFormat(),
          maxRetries: 3
        })

        if (fullPageResult && fullPageResult.parsed) {
          const { parsed, usage } = fullPageResult
          const declaredCount = parsed.total_products_visible || 0
          const itemsFound = Array.isArray(parsed.items) ? parsed.items : []

          console.log(`[Pass 1] Page ${expectedPage}: Pixtral declared ${declaredCount} products visible, extracted ${itemsFound.length} items`)

          if (usage) {
            promptTokens += usage.prompt_tokens || usage.promptTokens || 0
            completionTokens += usage.completion_tokens || usage.completionTokens || 0
          }

          for (const item of itemsFound) {
            item.row_id = String(globalRowId++).padStart(4, '0')
            item.page_number = expectedPage
            item.image_id = null
            item._source = 'fullpage'
            parsedAnnotation.items.push(item)
          }

        } else {
          console.warn(`[Pass 1] Full-page extraction returned no results for page ${expectedPage}`)

          // ═══════════════════════════════════════════════════════════════
          // FALLBACK: If full-page vision fails, use the old per-image approach
          // ═══════════════════════════════════════════════════════════════
          console.log(`[Fallback] Using per-image crop extraction for page ${expectedPage}...`)
          
          if (p.images && p.images.length > 0 && p.dimensions) {
            const dim = p.dimensions

            for (const img of p.images) {
              // Normalize bounding box
              const x = img.top_left_x / dim.width
              const y = img.top_left_y / dim.height
              const width = (img.bottom_right_x - img.top_left_x) / dim.width
              const height = (img.bottom_right_y - img.top_left_y) / dim.height

              // Skip tiny images (badges, icons, logos) — reduced threshold for better recall
              const areaRatio = width * height
              if (areaRatio < 0.001) continue

              // Skip header zone only (relaxed footer filter)
              const centerY = y + (height / 2)
              if (centerY < 0.06 || centerY > 0.97) continue

              // Crop image
              let cropBuffer: Buffer
              try {
                const pxX = Math.round(x * renderedPage.width)
                const pxY = Math.round(y * renderedPage.height)
                const pxWidth = Math.round(width * renderedPage.width)
                const pxHeight = Math.round(height * renderedPage.height)
                
                // padding 4% to include edge details
                const paddingX = Math.round(renderedPage.width * 0.04)
                const paddingY = Math.round(renderedPage.height * 0.04)
                
                const cropX = Math.max(0, pxX - paddingX)
                const cropY2 = Math.max(0, pxY - paddingY)
                const cropW = Math.min(renderedPage.width - cropX, pxWidth + paddingX * 2)
                const cropH = Math.min(renderedPage.height - cropY2, pxHeight + paddingY * 2)

                cropBuffer = await sharp(renderedPage.imagePath)
                  .extract({ left: cropX, top: cropY2, width: cropW, height: cropH })
                  .jpeg({ quality: 85 })
                  .toBuffer()
              } catch (e: any) {
                console.error(`Failed to crop image ${img.id}:`, e)
                continue
              }

              const base64Crop = cropBuffer.toString('base64')
              const cropUrl = `data:image/jpeg;base64,${base64Crop}`

              // (Handled by mistralRateLimitQueue)

              const cropResult = await callPixtralVision({
                apiKey,
                imageDataUrl: cropUrl,
                promptText: buildWifranCropExtractionPrompt(),
                schema: buildWifranCropAnnotationFormat(),
                maxRetries: 3
              })

              if (cropResult && cropResult.parsed && Array.isArray(cropResult.parsed.items)) {
                for (const item of cropResult.parsed.items) {
                  item.row_id = String(globalRowId++).padStart(4, '0')
                  item.page_number = expectedPage
                  item.image_id = img.id
                  item.bounding_box = { x, y, width, height }
                  item._source = 'percrop'
                  parsedAnnotation.items.push(item)
                }
              }

              if (cropResult?.usage) {
                promptTokens += cropResult.usage.prompt_tokens || cropResult.usage.promptTokens || 0
                completionTokens += cropResult.usage.completion_tokens || cropResult.usage.completionTokens || 0
              }
            }
          }
        }
      }
    }

    // Clean up internal _source markers before normalization
    for (const item of parsedAnnotation.items) {
      delete item._source
    }

    console.log(`[DEBUG] Total items extracted across all passes: ${parsedAnnotation.items.length}`)

    const normalizationResult = normalizeOcrExtractionResponse(parsedAnnotation)

    const debugPath = await saveOcrDebugData(
      input.workspacePath,
      input.chunkId,
      response,
      parsedAnnotation,
      normalizationResult.rows
    )

    let usageInfo: any = response.usage || response.usage_info || response.token_usage || response.pages_processed || null;
    let _rawTokens: number = promptTokens + completionTokens;

    if (usageInfo) {
      if (typeof usageInfo.total_tokens === 'number') _rawTokens += usageInfo.total_tokens;
    }

    return {
      provider: 'mistral',
      model: rawConfig.mistral.ocrModel || 'mistral-ocr-latest',
      chunkId: input.chunkId,
      originalPageNumbers: input.originalPageNumbers,
      rawResponse: response,
      rawDocumentAnnotation: parsedAnnotation,
      items: normalizationResult.items,
      normalizedRows: normalizationResult.rows,
      usageInfo,
      _rawTokens,
      debugFilePath: debugPath
    }
  }
}
