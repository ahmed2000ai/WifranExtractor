import { readFileSync } from 'fs'
import { loadEnvConfig } from '../config/env'
import { buildItemImageOcrPrompt } from './itemImageOcrPromptBuilder'
import { buildItemOcrJsonSchema } from '../../shared/schemas/itemOcrSchema'
import type { ItemOcrJson } from '../../shared/types/itemOcr'
import { error as logError, info } from '../logging/logger'
import { runWithMistralRateLimit } from './mistralRateLimitQueue'

export type ItemImageOcrInput = {
  localImagePath: string;
  itemNumber: string;
  pageNumber: number;
};

export type ItemImageOcrResult = {
  ok: boolean;
  itemNumber: string;
  pageNumber: number;
  ocr: ItemOcrJson | null;
  error?: { code: string; message: string } | null;
  usage?: { promptTokens: number; completionTokens: number } | null;
};

/**
 * OCRs a single cropped item image via Mistral Chat Completions (vision).
 * Returns a flexible ItemOcrJson or an error.
 */
export async function ocrSingleItemImage(input: ItemImageOcrInput): Promise<ItemImageOcrResult> {
  const config = loadEnvConfig()
  const apiKey = config.mistral.apiKey

  if (!apiKey) {
    return {
      ok: false,
      itemNumber: input.itemNumber,
      pageNumber: input.pageNumber,
      ocr: null,
      error: { code: 'MISSING_API_KEY', message: 'Mistral API key is not configured.' }
    }
  }

  // Read image as base64
  let imageBuffer: Buffer
  try {
    imageBuffer = readFileSync(input.localImagePath)
  } catch (e: any) {
    return {
      ok: false,
      itemNumber: input.itemNumber,
      pageNumber: input.pageNumber,
      ocr: null,
      error: { code: 'FLEX_ITEM_OCR_IMAGE_MISSING', message: `Could not read crop image: ${e.message}` }
    }
  }

  // Detect MIME type from extension
  const ext = input.localImagePath.split('.').pop()?.toLowerCase() || 'webp'
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp'
  const dataUrl = `data:${mime};base64,${imageBuffer.toString('base64')}`

  const promptText = buildItemImageOcrPrompt(input.itemNumber)
  const schema = buildItemOcrJsonSchema()

  let chatRes: Response | null = null

  try {
    chatRes = await runWithMistralRateLimit(
      {
        kind: 'item_extraction',
        label: 'Item image OCR',
        pageNumber: input.pageNumber,
        itemNumber: input.itemNumber
      },
      async () => {
        const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json; charset=utf-8'
          },
          body: JSON.stringify({
            model: 'pixtral-large-latest',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: promptText + '\n\nEXPECTED JSON SCHEMA:\n' + JSON.stringify(schema, null, 2) },
                  { type: 'image_url', image_url: { url: dataUrl } }
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
          const err: any = new Error(errText)
          err.status = res.status
          throw err
        }

        return res
      }
    )
  } catch (err: any) {
    logError(`Item OCR network error: ${err.message}`)
    chatRes = null
  }

  if (!chatRes || !chatRes.ok) {
    return {
      ok: false,
      itemNumber: input.itemNumber,
      pageNumber: input.pageNumber,
      ocr: null,
      error: { code: 'FLEX_ITEM_OCR_REQUEST_FAILED', message: `All attempts failed for item ${input.itemNumber}` }
    }
  }

  try {
    const chatJson = await chatRes.json()
    const content = chatJson.choices?.[0]?.message?.content
    const usage = chatJson.usage

    if (!content) {
      return {
        ok: false,
        itemNumber: input.itemNumber,
        pageNumber: input.pageNumber,
        ocr: null,
        error: { code: 'FLEX_ITEM_OCR_INVALID_JSON', message: 'Mistral returned empty content.' }
      }
    }

    const parsed = typeof content === 'string' ? JSON.parse(content) : content

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
       return {
        ok: false,
        itemNumber: input.itemNumber,
        pageNumber: input.pageNumber,
        ocr: null,
        error: { code: 'FLEX_ITEM_OCR_NON_OBJECT_JSON', message: 'Mistral returned non-object JSON.' }
      }
    }

    if ('currency' in parsed) {
      delete parsed.currency
    }

    info('Item OCR prompt mode: candidate_based_v1')

    // Minimal Adapter for Existing Downstream Code
    // Temporary compatibility adapter that derives legacy aliases from the new candidate response
    let finalOcr = parsed
    if (parsed.product_text && parsed.selected_prices && parsed.content) {
      finalOcr = {
        ...parsed,
        name_ar: parsed.product_text.title_ar,
        name_en: parsed.product_text.title_en,
        offer_price: parsed.selected_prices.offer_price,
        original_price: parsed.selected_prices.original_price,
        size: parsed.content.size_text,
        pack_quantity: parsed.content.pack_quantity,
        bundle_quantity: parsed.content.bundle_quantity,
        special_offer: parsed.promotion?.raw_text || null
      }
    }

    return {
      ok: true,
      itemNumber: input.itemNumber,
      pageNumber: input.pageNumber,
      ocr: finalOcr as ItemOcrJson,
      usage: usage ? {
        promptTokens: usage.prompt_tokens || usage.promptTokens || 0,
        completionTokens: usage.completion_tokens || usage.completionTokens || 0
      } : null
    }
  } catch (e: any) {
    return {
      ok: false,
      itemNumber: input.itemNumber,
      pageNumber: input.pageNumber,
      ocr: null,
      error: { code: 'FLEX_ITEM_OCR_INVALID_JSON', message: `Failed to parse OCR response: ${e.message}` }
    }
  }
}

