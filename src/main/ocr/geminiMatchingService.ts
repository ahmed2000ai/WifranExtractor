/**
 * Gemini Catalog Matching Service
 * Milestone: WIFRAN-EXTRACTOR-CATALOG-MATCH-001
 *
 * Implements intelligent product matching with:
 * - Model: gemini-3.8-flash
 * - Thinking Level: explicitly MEDIUM (independent of extraction HIGH)
 * - Mode: Vertex AI Flex PayGo, location global
 * - Minimal JSON Contract: { matches: [{ source_id: "1", product_id: "456" | "t1" | null }] }
 * - Dynamic token budgeting
 * - Strict deterministic response validation
 */

import { Type, type Schema } from '@google/genai'
import { getGeminiClient } from './geminiClient'
import { calculateGeminiCost } from './geminiPricingTable'
import { arePackConfigsStrictlyCompatible } from '../../shared/utils/sizeCompatibility'
import { evaluateIdentitySufficiency } from '../db/productIdentityPolicy'
import {
  CompactCatalogCandidate,
  GeminiMinimalMatchingResponse,
  GeminiMinimalMatchItem
} from '../../shared/types/catalogMatching'
import { DeduplicatedIdentityItem } from '../db/brandGroupingService'

export interface SourceIdCanonicalizationResult {
  normalizedId: string | null
  rawSourceId: string
  wasNormalized: boolean
  reason?:
    | 'NON_STRING_SOURCE_ID'
    | 'EMPTY_SOURCE_ID'
    | 'LEADING_ZERO_AMBIGUITY'
    | 'OUT_OF_RANGE_SOURCE_ID'
    | 'INVALID_SOURCE_ID_FORMAT'
}

const DOCUMENTED_ITEM_PREFIX_REGEX = /^item[\s_-]+([1-9]\d*)$/i

/**
 * Deterministically canonicalizes a model-returned source_id against exact request source IDs.
 * Allows ONLY documented forms ("1", "Item 1", "item_1", "item-1") matching request IDs,
 * rejecting leading-zero ambiguities ("01", "Item 01"), out-of-range IDs, and arbitrary substrings.
 */
export function canonicalizeMatchSourceId(
  rawSourceId: unknown,
  validSourceIds: Set<string>
): SourceIdCanonicalizationResult {
  if (typeof rawSourceId !== 'string') {
    return {
      normalizedId: null,
      rawSourceId: String(rawSourceId ?? ''),
      wasNormalized: false,
      reason: 'NON_STRING_SOURCE_ID'
    }
  }

  const trimmed = rawSourceId.trim()
  if (!trimmed) {
    return {
      normalizedId: null,
      rawSourceId: trimmed,
      wasNormalized: false,
      reason: 'EMPTY_SOURCE_ID'
    }
  }

  if (validSourceIds.has(trimmed)) {
    return {
      normalizedId: trimmed,
      rawSourceId: trimmed,
      wasNormalized: false
    }
  }

  // Explicitly reject leading-zero numeric forms like "01", "001"
  if (/^0+\d+$/.test(trimmed)) {
    return {
      normalizedId: null,
      rawSourceId: trimmed,
      wasNormalized: false,
      reason: 'LEADING_ZERO_AMBIGUITY'
    }
  }

  const prefixMatch = DOCUMENTED_ITEM_PREFIX_REGEX.exec(trimmed)
  if (prefixMatch) {
    const candidateId = prefixMatch[1]
    if (validSourceIds.has(candidateId)) {
      return {
        normalizedId: candidateId,
        rawSourceId: trimmed,
        wasNormalized: true
      }
    }
    return {
      normalizedId: null,
      rawSourceId: trimmed,
      wasNormalized: false,
      reason: 'OUT_OF_RANGE_SOURCE_ID'
    }
  }

  // Numeric string outside request IDs
  if (/^[1-9]\d*$/.test(trimmed)) {
    return {
      normalizedId: null,
      rawSourceId: trimmed,
      wasNormalized: false,
      reason: 'OUT_OF_RANGE_SOURCE_ID'
    }
  }

  return {
    normalizedId: null,
    rawSourceId: trimmed,
    wasNormalized: false,
    reason: 'INVALID_SOURCE_ID_FORMAT'
  }
}

export interface GeminiMatchingBatchRequest {
  brandKey: string
  brandName: string
  candidates: CompactCatalogCandidate[]
  items: DeduplicatedIdentityItem[]
  flexTimeoutMs?: number
  maxOutputTokens?: number
  abortSignal?: AbortSignal
}

export interface ClassifiedMatchingError {
  code: string
  message: string
  httpStatus: number | null
  isSystemic: boolean
  isUncertainOutcome: boolean
  isCancelled: boolean
  isTimeout: boolean
}

/**
 * Classifies Gemini matching failures into isolated transient/timeout errors,
 * operator cancellations, vs systemic environment/credential/schema/security halts.
 */
export function classifyMatchingError(err: unknown): ClassifiedMatchingError {
  const anyErr = err as any
  const message = String(anyErr?.message || err || 'Unknown matching error')
  const rawStatus = anyErr?.status ?? anyErr?.statusCode ?? anyErr?.code
  let httpStatus: number | null =
    typeof rawStatus === 'number' && Number.isFinite(rawStatus) ? rawStatus : null
  if (httpStatus === null) {
    const statusMatch = message.match(/\b(400|401|403|404|408|429|500|502|503|504)\b/)
    if (statusMatch) httpStatus = Number(statusMatch[1])
  }

  const upper = message.toUpperCase()
  const isCancelled =
    upper.includes('MATCHING_CANCELLED') ||
    anyErr?.name === 'AbortError' && upper.includes('CANCEL')

  const isTimeout =
    upper.includes('FLEX_MATCHING_TIMEOUT') ||
    upper.includes('DEADLINE_EXCEEDED') ||
    upper.includes('ETIMEDOUT') ||
    httpStatus === 504 ||
    httpStatus === 408

  const isSystemic =
    !isCancelled &&
    !isTimeout &&
    (upper.includes('FLEX_REQUIRES_GLOBAL_LOCATION') ||
      upper.includes('ENVIRONMENT_ISOLATION') ||
      upper.includes('SYSTEMIC_INTEGRITY_ERROR') ||
      upper.includes('CANDIDATE_INTEGRITY') ||
      upper.includes('SCHEMA_CONTRACT') ||
      upper.includes('GEMINI_ENV') ||
      upper.includes('UNAUTHENTICATED') ||
      upper.includes('PERMISSION_DENIED') ||
      upper.includes('API_KEY') ||
      upper.includes('CREDENTIALS') ||
      httpStatus === 400 ||
      httpStatus === 401 ||
      httpStatus === 403)

  const isNetworkUncertain =
    upper.includes('ECONNRESET') ||
    upper.includes('ECONNABORTED') ||
    upper.includes('SOCKET') ||
    upper.includes('FETCH FAILED') ||
    upper.includes('NETWORK')

  const isUncertainOutcome =
    isTimeout ||
    upper.includes('IN_FLIGHT') ||
    isNetworkUncertain

  let code = 'GEMINI_REQUEST_FAILED'
  if (isCancelled) {
    code = upper.includes('IN_FLIGHT') ? 'MATCHING_CANCELLED_IN_FLIGHT' : 'MATCHING_CANCELLED'
  } else if (isTimeout) {
    code = httpStatus === 504 || upper.includes('DEADLINE_EXCEEDED') ? 'DEADLINE_EXCEEDED_504' : 'FLEX_MATCHING_TIMEOUT'
  } else if (isSystemic) {
    code = 'SYSTEMIC_MATCHING_ERROR'
  } else if (httpStatus === 429 || upper.includes('RESOURCE_EXHAUSTED')) {
    code = 'RATE_LIMITED_429'
  } else if (message.includes('JSON')) {
    code = 'INVALID_MODEL_JSON_RESPONSE'
  }

  return {
    code,
    message,
    httpStatus,
    isSystemic,
    isUncertainOutcome,
    isCancelled,
    isTimeout
  }
}

export interface ReconciledMatchOutcome {
  item: DeduplicatedIdentityItem
  sourceId?: string
  rawModelSourceId?: string | null
  wasSourceIdNormalized?: boolean
  matchedProductId: string | null
  temporaryRef: string | null
  validationIssues: string[]
}

export interface UnrecognizedSourceEntry {
  rawSourceId: string
  rawProductId: string | null
  reason: string
}

export interface MatchingEvaluationResult {
  matches: ReconciledMatchOutcome[]
  usage: {
    inputTokens: number
    outputTokens: number
    thinkingTokens: number
    cachedTokens?: number
    totalTokens?: number
    actualCostUsd: number
    executionTier: 'flex' | 'standard'
    metadataMissing?: boolean
    rawUsageMetadata?: Record<string, any> | null
    finishReason?: string | null
    modelId?: string
  }
  rawModelResponseText?: string
  rawParsedResponse?: GeminiMinimalMatchingResponse
  latencyMs?: number
  sourcePromptMapping?: Array<{ sourceId: string; identityKey: string; titleEn: string | null }>
  requestDiagnostics?: string[]
  unrecognizedEntries?: UnrecognizedSourceEntry[]
}

export class GeminiMatchingService {
  private customMockEvaluator?: (req: GeminiMatchingBatchRequest) => Promise<GeminiMinimalMatchingResponse>

  constructor(mockEvaluator?: (req: GeminiMatchingBatchRequest) => Promise<GeminiMinimalMatchingResponse>) {
    this.customMockEvaluator = mockEvaluator
  }

  /**
   * Builds deterministic, structured prompt payload with explicit verbatim source_id
   * and manufacturer packaging vs retail promotional quantity separation.
   */
  public buildPromptPayload(req: GeminiMatchingBatchRequest): {
    sourceMap: Map<string, DeduplicatedIdentityItem>
    validSourceIds: string[]
    systemPrompt: string
    userContent: string
    authorizedCandidateIds: Set<string>
  } {
    const sourceMap: Map<string, DeduplicatedIdentityItem> = new Map()
    const serializedItems: string[] = []
    const validSourceIds: string[] = []

    req.items.forEach((item, idx) => {
      const sourceId = String(idx + 1)
      sourceMap.set(sourceId, item)
      validSourceIds.push(sourceId)

      const attrs = item.normalizedAttrs
      const sizeStr =
        attrs.eachSizeValue !== null ? `${attrs.eachSizeValue} ${attrs.eachSizeUnit || ''}`.trim() : 'unspecified'
      const mfgPack = attrs.manufacturerPackCount ?? attrs.innerPackCount ?? 1
      const itemPayload: Record<string, unknown> = {
        source_id: sourceId,
        brand: attrs.brandNameEn || req.brandName,
        name_en: attrs.productNameEn || '',
        name_ar: attrs.productNameAr || '',
        size: sizeStr,
        mfg_pack: mfgPack > 1 ? mfgPack : 1
      }
      if (attrs.fatContent) itemPayload.fat = attrs.fatContent
      if (attrs.variantOrFlavor) itemPayload.variant = attrs.variantOrFlavor
      if (attrs.promoPurchaseQuantity && attrs.promoPurchaseQuantity > 1) {
        itemPayload.retail_promo_qty = attrs.promoPurchaseQuantity
      }
      if (attrs.isAssortment) {
        itemPayload.assortment_ambiguity = true
      }

      serializedItems.push(JSON.stringify(itemPayload))
    })

    const candidateLines: string[] = []
    const authorizedCandidateIds: Set<string> = new Set()

    req.candidates.forEach((cand) => {
      authorizedCandidateIds.add(String(cand.id))
      const candSize = cand.sizeValue !== null ? `${cand.sizeValue} ${cand.sizeUnit || ''}`.trim() : 'unspecified'
      const candPack = cand.packCount && cand.packCount > 1 ? `pack of ${cand.packCount}` : 'single'
      const candVariant = cand.variant ? ` (${cand.variant})` : ''

      candidateLines.push(
        `[ID ${cand.id}]: "${cand.nameEn}" / "${cand.nameAr}" | Brand: ${cand.brand} | Size: ${candSize} | Pack: ${candPack}${candVariant}`
      )
    })

    const systemPrompt = `You are the Wifran Catalog Matching Engine.
Your task is to match extracted supermarket leaflet items to verified catalog products, OR group new products under temporary references.

RULES:
1. SOURCE_ID CONTRACT: Each input object contains an exact "source_id" (such as "1", "2"). Copy "source_id" VERBATIM into your response. NEVER add "Item ", prefixes, or change the identifier format. Include one mapping per input item and never invent source IDs.
2. EXACT CATALOG MATCH: Match an extracted item to a catalog product ID ONLY when brand, product identity, net unit size, variant/fat content, and manufacturer packaging ("mfg_pack") are compatible.
3. MANUFACTURER PACK VS RETAILER PROMOTION: Compare products strictly using "mfg_pack" and unit "size", NOT "retail_promo_qty". When a retailer sells multiple individual manufacturer units together as a promo (e.g. retail_promo_qty: 3 of a single 900g chicken, mfg_pack: 1), match the underlying single-unit catalog product (Pack: single) — NEVER create a temporary "tX" SKU solely because of a retail multi-buy quantity. Conversely, keep genuine manufacturer-sealed multipacks/cartons (e.g. mfg_pack: 10, 10 x 900g or 4 x 250ml) distinct from single units.
4. NEW PRODUCTS & ASSORTMENT SAFETY:
   - If multiple items represent the SAME genuinely absent new product, assign the SAME temporary reference ("t1", "t2", etc.); if unique, assign its own "tX".
   - If an item has assortment_ambiguity=true, multiple slash-separated product options, or ambiguous/missing variant identity, return product_id: null.
5. NEVER invent catalog product IDs. Use ONLY candidate IDs from CATALOG CANDIDATES, temporary "tX" references, or null.
6. Return JSON ONLY adhering to the declared schema.`

    const userContent = `BRAND: ${req.brandName} (${req.brandKey})

CATALOG CANDIDATES:
${candidateLines.length > 0 ? candidateLines.join('\n') : '(No existing catalog products found for this brand)'}

EXTRACTED ITEMS TO MATCH (copy source_id verbatim):
${serializedItems.join('\n')}`

    return { sourceMap, validSourceIds, systemPrompt, userContent, authorizedCandidateIds }
  }

  /**
   * Evaluates a batch of deduplicated extracted items against candidate catalog products.
   * Thinking level is locked to MEDIUM; Flex PayGo is enforced.
   */
  public async evaluateBatch(req: GeminiMatchingBatchRequest): Promise<MatchingEvaluationResult> {
    const { sourceMap, validSourceIds, systemPrompt, userContent, authorizedCandidateIds } =
      this.buildPromptPayload(req)

    let rawResponse: GeminiMinimalMatchingResponse
    const usageMeta: MatchingEvaluationResult['usage'] = {
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      actualCostUsd: 0,
      executionTier: 'flex'
    }
    const telemetry: { rawText?: string; latencyMs?: number } = {}
    const startMs = Date.now()

    // Check pre-dispatch abort before incurring any provider call
    if (req.abortSignal?.aborted) {
      throw new Error('MATCHING_CANCELLED: Matching operation was cancelled before dispatching request.')
    }

    // Check for mock or offline evaluation
    if (this.customMockEvaluator) {
      rawResponse = await this.invokeMockEvaluatorWithAbort(req)
      telemetry.rawText = JSON.stringify(rawResponse)
      telemetry.latencyMs = Date.now() - startMs
      usageMeta.inputTokens = 120 + req.candidates.length * 15 + req.items.length * 20
      usageMeta.outputTokens = req.items.length * 10
      usageMeta.thinkingTokens = 200
      usageMeta.totalTokens = usageMeta.inputTokens + usageMeta.outputTokens + usageMeta.thinkingTokens
      usageMeta.metadataMissing = false
      const costCalc = calculateGeminiCost(
        {
          promptTokenCount: usageMeta.inputTokens,
          candidatesTokenCount: usageMeta.outputTokens,
          thoughtsTokenCount: usageMeta.thinkingTokens
        },
        'gemini-3.8-flash',
        'flex'
      )
      usageMeta.actualCostUsd = costCalc.totalCostUsd
    } else if (process.env.WIFRAN_OFFLINE_UAT === '1') {
      // Deterministic offline mock for UAT / test suites
      rawResponse = this.generateDeterministicOfflineResponse(req, authorizedCandidateIds)
      telemetry.rawText = JSON.stringify(rawResponse)
      telemetry.latencyMs = Date.now() - startMs
      usageMeta.inputTokens = 150
      usageMeta.outputTokens = req.items.length * 8
      usageMeta.thinkingTokens = 100
      usageMeta.totalTokens = usageMeta.inputTokens + usageMeta.outputTokens + usageMeta.thinkingTokens
      usageMeta.metadataMissing = false
      usageMeta.actualCostUsd = 0
    } else {
      // Vertex AI Flex PayGo Execution with MEDIUM thinking (zero automatic retry / no Standard fallback)
      rawResponse = await this.callGeminiApi(systemPrompt, userContent, usageMeta, telemetry, {
        validSourceIds,
        flexTimeoutMs: req.flexTimeoutMs,
        maxOutputTokens: req.maxOutputTokens,
        abortSignal: req.abortSignal
      })
    }

    // 4. Deterministic response validation with safe source_id canonicalization
    let reconciliation: ReturnType<GeminiMatchingService['validateAndReconcileResponseDetailed']>
    try {
      reconciliation = this.validateAndReconcileResponseDetailed(
        rawResponse,
        sourceMap,
        req.candidates,
        authorizedCandidateIds
      )
    } catch (err: any) {
      if (err && typeof err === 'object') {
        err.usage = err.usage || usageMeta
        err.latencyMs = err.latencyMs ?? telemetry.latencyMs
        err.rawModelResponseText = err.rawModelResponseText ?? telemetry.rawText
      }
      throw err
    }

    const sourcePromptMapping = Array.from(sourceMap.entries()).map(([sourceId, item]) => ({
      sourceId,
      identityKey: item.identityKey,
      titleEn: item.normalizedAttrs.productNameEn
    }))

    return {
      matches: reconciliation.matches,
      usage: usageMeta,
      rawModelResponseText: telemetry.rawText,
      rawParsedResponse: rawResponse,
      latencyMs: telemetry.latencyMs,
      sourcePromptMapping,
      requestDiagnostics: reconciliation.requestDiagnostics,
      unrecognizedEntries: reconciliation.unrecognizedEntries
    }
  }

  public buildRequestConfig(options?: {
    validSourceIds?: string[]
    flexTimeoutMs?: number
    maxOutputTokens?: number
  }): any {
    const validSourceIds = options?.validSourceIds || []
    const timeoutMs =
      options?.flexTimeoutMs ||
      Number(process.env.GEMINI_MATCHING_FLEX_TIMEOUT_MS) ||
      Number(process.env.GEMINI_FLEX_TIMEOUT_MS) ||
      600_000
    const boundedMaxOutputTokens =
      options?.maxOutputTokens && options.maxOutputTokens > 0
        ? options.maxOutputTokens
        : Math.min(4096, Math.max(2048, validSourceIds.length * 128 + 1536))

    const sourceIdSchema: Schema =
      validSourceIds.length > 0 && validSourceIds.length <= 100
        ? { type: Type.STRING, enum: validSourceIds }
        : { type: Type.STRING }

    return {
      thinkingConfig: { thinkingLevel: 'MEDIUM' },
      maxOutputTokens: boundedMaxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          matches: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                source_id: sourceIdSchema,
                product_id: { type: Type.STRING, nullable: true }
              },
              required: ['source_id', 'product_id']
            }
          }
        },
        required: ['matches']
      } satisfies Schema,
      httpOptions: {
        timeout: timeoutMs,
        headers: {
          'X-Vertex-AI-LLM-Request-Type': 'shared',
          'X-Vertex-AI-LLM-Shared-Request-Type': 'flex'
        }
      }
    }
  }

  private async invokeMockEvaluatorWithAbort(
    req: GeminiMatchingBatchRequest
  ): Promise<GeminiMinimalMatchingResponse> {
    if (!this.customMockEvaluator) {
      throw new Error('Mock evaluator not configured.')
    }
    const signal = req.abortSignal
    if (!signal) {
      return await this.customMockEvaluator(req)
    }
    if (signal.aborted) {
      throw new Error('MATCHING_CANCELLED: Matching operation was cancelled before dispatching request.')
    }

    let onAbort: (() => void) | null = null
    try {
      const abortPromise = new Promise<never>((_resolve, reject) => {
        onAbort = () => {
          reject(
            new Error(
              'MATCHING_CANCELLED_IN_FLIGHT: Operator cancelled while Flex matching request was in flight (outcome uncertain; provider billing or backend execution may not have been aborted).'
            )
          )
        }
        signal.addEventListener('abort', onAbort, { once: true })
      })
      return await Promise.race([this.customMockEvaluator(req), abortPromise])
    } finally {
      if (onAbort) {
        signal.removeEventListener('abort', onAbort)
      }
    }
  }

  private async callGeminiApi(
    systemPrompt: string,
    userContent: string,
    usageMeta: any,
    telemetry?: { rawText?: string; latencyMs?: number },
    options?: {
      validSourceIds?: string[]
      flexTimeoutMs?: number
      maxOutputTokens?: number
      abortSignal?: AbortSignal
    }
  ): Promise<GeminiMinimalMatchingResponse> {
    if (options?.abortSignal?.aborted) {
      throw new Error('MATCHING_CANCELLED: Matching operation was cancelled before dispatching request.')
    }

    const ai = getGeminiClient()
    const model = 'gemini-3.8-flash'
    const location = process.env.GCP_LOCATION || 'global'

    if (location !== 'global') {
      throw new Error(
        `FLEX_REQUIRES_GLOBAL_LOCATION: Vertex AI Flex PayGo requires location="global", but resolved "${location}". Refusing silent fallback.`
      )
    }

    const requestConfig = this.buildRequestConfig(options)
    const timeoutMs = requestConfig.httpOptions.timeout as number
    const abortController = new AbortController()
    requestConfig.abortSignal = abortController.signal

    let timedOut = false
    let cancelledByParent = false

    const onParentAbort = () => {
      cancelledByParent = true
      abortController.abort()
    }
    if (options?.abortSignal) {
      options.abortSignal.addEventListener('abort', onParentAbort, { once: true })
    }

    const timer = setTimeout(() => {
      timedOut = true
      abortController.abort()
    }, timeoutMs)

    const startMs = Date.now()
    let response: any
    try {
      response = await ai.models.generateContent({
        model,
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userContent}` }] }
        ],
        config: requestConfig
      })
    } catch (err: any) {
      usageMeta.modelId = model
      usageMeta.metadataMissing = true
      if (cancelledByParent || options?.abortSignal?.aborted) {
        const e: any = new Error(
          'MATCHING_CANCELLED_IN_FLIGHT: Operator cancelled while Flex matching request was in flight (outcome uncertain; Vertex AI backend execution/billing cannot be guaranteed stopped).'
        )
        e.usage = usageMeta
        e.latencyMs = Date.now() - startMs
        throw e
      }
      if (timedOut || abortController.signal.aborted) {
        const e: any = new Error(
          `FLEX_MATCHING_TIMEOUT: Gemini Flex matching request timed out after ${timeoutMs}ms (uncertain execution state; zero automatic retry or Standard fallback performed to prevent duplicate billing).`
        )
        e.usage = usageMeta
        e.latencyMs = Date.now() - startMs
        throw e
      }
      if (err && typeof err === 'object') {
        err.usage = err.usage || usageMeta
        err.latencyMs = err.latencyMs ?? (Date.now() - startMs)
      }
      throw err
    } finally {
      clearTimeout(timer)
      if (options?.abortSignal) {
        options.abortSignal.removeEventListener('abort', onParentAbort)
      }
      if (telemetry) {
        telemetry.latencyMs = Date.now() - startMs
      }
    }

    const rawText = response.text || '{}'
    if (telemetry) {
      telemetry.rawText = rawText
    }
    const candidate0 = response?.candidates?.[0]
    const finishReason = candidate0?.finishReason ? String(candidate0.finishReason) : null

    // Capture usage metadata BEFORE JSON parsing so truncated/malformed JSON never erases API cost
    usageMeta.modelId = model
    usageMeta.finishReason = finishReason
    if (response.usageMetadata) {
      const promptTokens = response.usageMetadata.promptTokenCount || 0
      const candidatesTokens = response.usageMetadata.candidatesTokenCount || 0
      // Check both thoughtsTokenCount and thinkingTokenCount from SDK
      const thoughtsTokens =
        (response.usageMetadata as any).thoughtsTokenCount ??
        (response.usageMetadata as any).thinkingTokenCount ??
        0
      const cachedTokens = response.usageMetadata.cachedContentTokenCount || 0
      const totalTokens = response.usageMetadata.totalTokenCount ?? (promptTokens + candidatesTokens + thoughtsTokens)

      usageMeta.inputTokens = promptTokens
      usageMeta.outputTokens = candidatesTokens
      usageMeta.thinkingTokens = thoughtsTokens
      usageMeta.cachedTokens = cachedTokens
      usageMeta.totalTokens = totalTokens
      usageMeta.executionTier = 'flex'
      usageMeta.metadataMissing = false
      usageMeta.rawUsageMetadata = response.usageMetadata

      const calculated = calculateGeminiCost(
        {
          promptTokenCount: promptTokens,
          candidatesTokenCount: candidatesTokens,
          thoughtsTokenCount: thoughtsTokens,
          cachedContentTokenCount: cachedTokens,
          totalTokenCount: response.usageMetadata.totalTokenCount
        },
        model,
        'flex'
      )
      usageMeta.actualCostUsd = calculated.totalCostUsd
    } else {
      usageMeta.metadataMissing = true
      usageMeta.rawUsageMetadata = null
    }

    let parsed: GeminiMinimalMatchingResponse
    try {
      parsed = JSON.parse(rawText) as GeminiMinimalMatchingResponse
    } catch (parseErr: any) {
      if (parseErr && typeof parseErr === 'object') {
        parseErr.usage = usageMeta
        parseErr.latencyMs = telemetry?.latencyMs
        parseErr.rawModelResponseText = rawText
      }
      throw parseErr
    }

    return parsed
  }

  /**
   * Deterministic Offline Response generator for tests and UAT ($0 cost).
   */
  private generateDeterministicOfflineResponse(
    req: GeminiMatchingBatchRequest,
    _authorizedCandidateIds: Set<string>
  ): GeminiMinimalMatchingResponse {
    const matches: GeminiMinimalMatchItem[] = []
    let nextTempId = 1
    const newProductGroupMap: Map<string, string> = new Map()

    req.items.forEach((item, idx) => {
      const sourceId = String(idx + 1)
      const attrs = item.normalizedAttrs
      const sufficiency = evaluateIdentitySufficiency(attrs, item.memberOffers[0])
      if (!sufficiency.isSufficient) {
        matches.push({ source_id: sourceId, product_id: null })
        return
      }

      const mfgPack = attrs.manufacturerPackCount ?? attrs.innerPackCount ?? 1

      // Look for candidate match
      let matchedCandidate: CompactCatalogCandidate | null = null
      for (const cand of req.candidates) {
        // Strict match on size and manufacturer packaging
        const sizeMatch =
          attrs.eachSizeValue !== null &&
          cand.sizeValue !== null &&
          Math.abs(attrs.eachSizeValue - cand.sizeValue) < 0.01 &&
          attrs.eachSizeUnit === cand.sizeUnit
        const packMatch = mfgPack === (cand.packCount || 1)

        // Check fat compatibility
        let fatMatch = true
        if (attrs.fatContent && cand.variant) {
          if (attrs.fatContent.toLowerCase() !== cand.variant.toLowerCase()) {
            fatMatch = false
          }
        }

        if (sizeMatch && packMatch && fatMatch) {
          matchedCandidate = cand
          break
        }
      }

      if (matchedCandidate) {
        matches.push({ source_id: sourceId, product_id: matchedCandidate.id })
      } else {
        // Group new product under temporary reference (strictly using manufacturer pack)
        const groupKey = `${attrs.brandKey}:${attrs.eachSizeValue}:${attrs.eachSizeUnit}:${mfgPack}:${attrs.fatContent}`
        if (!newProductGroupMap.has(groupKey)) {
          newProductGroupMap.set(groupKey, `t${nextTempId++}`)
        }
        matches.push({ source_id: sourceId, product_id: newProductGroupMap.get(groupKey)! })
      }
    })

    return { matches }
  }

  /**
   * Detailed reconciliation exposing canonicalized source IDs, collision/duplicate errors,
   * unrecognized source diagnostics, candidate whitelist enforcement, and identity sufficiency checks.
   */
  public validateAndReconcileResponseDetailed(
    response: GeminiMinimalMatchingResponse,
    sourceMap: Map<string, DeduplicatedIdentityItem>,
    candidates: CompactCatalogCandidate[],
    authorizedCandidateIds: Set<string>
  ): {
    matches: ReconciledMatchOutcome[]
    requestDiagnostics: string[]
    unrecognizedEntries: UnrecognizedSourceEntry[]
  } {
    const results: ReconciledMatchOutcome[] = []
    const requestDiagnostics: string[] = []
    const unrecognizedEntries: UnrecognizedSourceEntry[] = []

    const candMap = new Map<string, CompactCatalogCandidate>()
    candidates.forEach((c) => candMap.set(String(c.id), c))

    const validSourceIds = new Set<string>(sourceMap.keys())
    const groupedByNormalizedId = new Map<
      string,
      Array<{ rawSourceId: string; wasNormalized: boolean; match: GeminiMinimalMatchItem }>
    >()

    for (const match of response.matches || []) {
      const canon = canonicalizeMatchSourceId((match as any).source_id, validSourceIds)
      if (!canon.normalizedId) {
        const rawProd =
          match.product_id !== null && match.product_id !== undefined ? String(match.product_id).trim() : null
        unrecognizedEntries.push({
          rawSourceId: canon.rawSourceId,
          rawProductId: rawProd,
          reason: canon.reason || 'INVALID_SOURCE_ID_FORMAT'
        })
        requestDiagnostics.push(
          `UNRECOGNIZED_SOURCE_ID: Raw source_id "${canon.rawSourceId}" (${canon.reason || 'unrecognized'}) for product_id="${rawProd ?? 'null'}" does not match any request source ID.`
        )
        continue
      }

      const bucket = groupedByNormalizedId.get(canon.normalizedId) || []
      bucket.push({
        rawSourceId: canon.rawSourceId,
        wasNormalized: canon.wasNormalized,
        match
      })
      groupedByNormalizedId.set(canon.normalizedId, bucket)
    }

    // Iterate deterministically over request sourceMap order
    for (const [sourceId, item] of sourceMap.entries()) {
      const entries = groupedByNormalizedId.get(sourceId) || []

      if (entries.length === 0) {
        const extraUnrecognizedNote =
          unrecognizedEntries.length > 0
            ? ` Response also contained unrecognized source_id values: [${unrecognizedEntries.map((u) => `"${u.rawSourceId}"`).join(', ')}].`
            : ''
        results.push({
          item,
          sourceId,
          rawModelSourceId: null,
          wasSourceIdNormalized: false,
          matchedProductId: null,
          temporaryRef: null,
          validationIssues: [
            `MISSING_SOURCE_ID: Request source_id "${sourceId}" had no valid mapping in model response.${extraUnrecognizedNote}`
          ]
        })
        continue
      }

      if (entries.length > 1) {
        const rawIds = entries.map((e) => e.rawSourceId)
        const distinctRawIds = new Set(rawIds)
        if (distinctRawIds.size > 1) {
          results.push({
            item,
            sourceId,
            rawModelSourceId: rawIds.join(', '),
            wasSourceIdNormalized: true,
            matchedProductId: null,
            temporaryRef: null,
            validationIssues: [
              `SOURCE_ID_NORMALIZATION_COLLISION: Distinct raw source IDs [${rawIds.map((r) => `"${r}"`).join(', ')}] collapsed to "${sourceId}". Rejected without last-write-wins.`
            ]
          })
        } else {
          results.push({
            item,
            sourceId,
            rawModelSourceId: rawIds[0],
            wasSourceIdNormalized: entries[0].wasNormalized,
            matchedProductId: null,
            temporaryRef: null,
            validationIssues: [
              `DUPLICATE_SOURCE_ID: Model returned ${entries.length} mappings for source_id "${sourceId}" (raw: "${rawIds[0]}"). Rejected.`
            ]
          })
        }
        continue
      }

      const { rawSourceId, wasNormalized, match } = entries[0]
      const rawProductId =
        match.product_id !== null && match.product_id !== undefined ? String(match.product_id).trim() : null
      const validationIssues: string[] = []
      const attrs = item.normalizedAttrs
      const sufficiency = evaluateIdentitySufficiency(attrs, item.memberOffers[0])

      if (!rawProductId) {
        // Explicit abstention -> unresolved
        results.push({
          item,
          sourceId,
          rawModelSourceId: rawSourceId,
          wasSourceIdNormalized: wasNormalized,
          matchedProductId: null,
          temporaryRef: null,
          validationIssues
        })
        continue
      }

      // Temporary product proposal ("t1", "t2", ...)
      if (/^[tT]/.test(rawProductId) || /temp/i.test(rawProductId)) {
        const tempClean = rawProductId.toLowerCase()
        if (!/^t[1-9]\d*$/.test(tempClean)) {
          validationIssues.push(
            `INVALID_PRODUCT_ID (INVALID_TEMPORARY_SYNTAX): "${rawProductId}" does not match valid t<number> format.`
          )
          results.push({
            item,
            sourceId,
            rawModelSourceId: rawSourceId,
            wasSourceIdNormalized: wasNormalized,
            matchedProductId: null,
            temporaryRef: null,
            validationIssues
          })
          continue
        }

        // Enforce identity sufficiency BEFORE permitting temporary SKU creation
        if (!sufficiency.isSufficient) {
          const code = sufficiency.isAssortment ? 'REJECTED_ASSORTMENT_AMBIGUITY' : 'REJECTED_INSUFFICIENT_IDENTITY'
          validationIssues.push(
            `${code}: Model proposed temporary "${tempClean}", but identity is insufficient/ambiguous (${sufficiency.reasons.join(' ')}). Demoted to unresolved.`
          )
          results.push({
            item,
            sourceId,
            rawModelSourceId: rawSourceId,
            wasSourceIdNormalized: wasNormalized,
            matchedProductId: null,
            temporaryRef: null,
            validationIssues
          })
          continue
        }

        results.push({
          item,
          sourceId,
          rawModelSourceId: rawSourceId,
          wasSourceIdNormalized: wasNormalized,
          matchedProductId: null,
          temporaryRef: tempClean,
          validationIssues
        })
        continue
      }

      // Existing Product ID syntax + candidate whitelist check
      if (!authorizedCandidateIds.has(rawProductId)) {
        const isWellFormedIdSyntax = /^[a-zA-Z0-9_-]+$/.test(rawProductId)
        const errorCode = isWellFormedIdSyntax ? 'UNAUTHORIZED_CANDIDATE_ID' : 'INVALID_PRODUCT_ID'
        validationIssues.push(
          `${errorCode}: Product ID "${rawProductId}" (for raw source_id "${rawSourceId}") is not in the authorized candidate list for this request. Rejected.`
        )
        results.push({
          item,
          sourceId,
          rawModelSourceId: rawSourceId,
          wasSourceIdNormalized: wasNormalized,
          matchedProductId: null,
          temporaryRef: null,
          validationIssues
        })
        continue
      }

      // Enforce assortment / identity sufficiency BEFORE linking to an existing catalog product
      if (!sufficiency.isSufficient) {
        const code = sufficiency.isAssortment ? 'REJECTED_ASSORTMENT_AMBIGUITY' : 'REJECTED_INSUFFICIENT_IDENTITY'
        validationIssues.push(
          `${code}: Existing-product link "${rawProductId}" blocked (${sufficiency.reasons.join(' ')}). Demoted to unresolved.`
        )
        results.push({
          item,
          sourceId,
          rawModelSourceId: rawSourceId,
          wasSourceIdNormalized: wasNormalized,
          matchedProductId: null,
          temporaryRef: null,
          validationIssues
        })
        continue
      }

      const candidate = candMap.get(rawProductId)!
      const mfgPack = attrs.manufacturerPackCount ?? attrs.innerPackCount ?? 1

      // Strict attribute verification: Mathematically exact size and manufacturer pack compatibility (ZERO loose tolerance)
      const packCompat = arePackConfigsStrictlyCompatible({
        sizeValue1: attrs.eachSizeValue,
        sizeUnit1: attrs.eachSizeUnit,
        packCount1: mfgPack,
        sizeValue2: candidate.sizeValue,
        sizeUnit2: candidate.sizeUnit,
        packCount2: candidate.packCount
      })
      if (!packCompat.isCompatible) {
        validationIssues.push(`INCOMPATIBLE_SIZE: ${packCompat.reason}. Rejected.`)
      }

      // Fat content / variant compatibility
      if (attrs.fatContent && candidate.variant) {
        const extFat = attrs.fatContent.toLowerCase()
        const catVar = candidate.variant.toLowerCase()
        if (
          (extFat.includes('full') && (catVar.includes('low') || catVar.includes('skim') || catVar.includes('zero'))) ||
          (extFat.includes('low') && (catVar.includes('full') || catVar.includes('whole')))
        ) {
          validationIssues.push(
            `INCOMPATIBLE_FAT_CONTENT: Extracted "${attrs.fatContent}" conflicts with catalog variant "${candidate.variant}". Rejected.`
          )
        }
      }

      if (validationIssues.length > 0) {
        results.push({
          item,
          sourceId,
          rawModelSourceId: rawSourceId,
          wasSourceIdNormalized: wasNormalized,
          matchedProductId: null,
          temporaryRef: null,
          validationIssues
        })
      } else {
        results.push({
          item,
          sourceId,
          rawModelSourceId: rawSourceId,
          wasSourceIdNormalized: wasNormalized,
          matchedProductId: rawProductId,
          temporaryRef: null,
          validationIssues
        })
      }
    }

    return {
      matches: results,
      requestDiagnostics,
      unrecognizedEntries
    }
  }

  /**
   * Strictly validates returned matches against:
   * - Source-ID contract & canonicalization rules
   * - Authorized candidate set (rejecting hallucinations)
   * - Identity completeness & assortment safety gates
   * - Physical identity compatibility (size, unit, manufacturer pack count, fat content)
   */
  public validateAndReconcileResponse(
    response: GeminiMinimalMatchingResponse,
    sourceMap: Map<string, DeduplicatedIdentityItem>,
    candidates: CompactCatalogCandidate[],
    authorizedCandidateIds: Set<string>
  ): ReconciledMatchOutcome[] {
    return this.validateAndReconcileResponseDetailed(response, sourceMap, candidates, authorizedCandidateIds).matches
  }
}
