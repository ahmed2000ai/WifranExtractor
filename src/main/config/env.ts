import { config } from 'dotenv'
import { join } from 'path'

// Load .env.local if present, then fallback to .env across various working dirs
const envPaths = [
  join(process.cwd(), '.env.local'),
  join(process.cwd(), '.env'),
  join(__dirname, '../../../../.env.local'),
  join(__dirname, '../../../../.env'),
  join(__dirname, '../../../.env.local'),
  join(__dirname, '../../../.env')
];
for (const p of envPaths) {
  config({ path: p });
}

export type AppConfig = {
  supabase: {
    url: string
    anonKey?: string
    serviceRoleKey: string
    storageBucket: string
    accessToken?: string
  }
  mistral: {
    apiKey: string
    ocrModel: string
    ocrEndpoint: string
  }
  gemini: {
    apiKey: string
    model: string
    thinkingLevel: 'HIGH' | 'LOW' | 'MEDIUM'
    retryModel: string
    escalationModel: string
    executionMode: 'standard' | 'batch' | 'flex'
    googleApplicationCredentials?: string
    gcpProjectId?: string
    gcpLocation?: string
  }
  ocr: {
    chunkSize: number
    maxConcurrentRequests: number
    maxRetries: number
    retryBaseDelayMs: number
    requestTimeoutMs: number
    confidenceGranularity: 'page' | 'word'
    tableFormat: 'markdown' | 'html' | 'text'
    requestsPerSecondLimit: number
    minRequestIntervalMs: number
    tokensPerMinuteLimit: number
    tpmSafetyRatio: number
    estimatedTokensPerPage: number
    estimatedTokensPerDensePage: number
    rateLimitMode: 'free_tier_safe' | 'standard'
  }
  pdf: {
    renderDpi: number
  }
  images: {
    cropPaddingPercent: number
    outputFormat: 'jpg' | 'jpeg' | 'png' | 'webp'
    outputQuality: number
  }
  importBehavior: {
    defaultOfferDurationDays: number
    defaultOfferStatus: 'draft' | 'needs_review' | 'published'
    importDefaultStatus: 'published' | 'needs_review'
    allowNeedsReviewFallback: boolean
    publishWarningsAllowed: boolean
    lowConfidenceThreshold: number
    dataQualityNeedsReviewThreshold: number
    skipDuplicateOffers: boolean
    autoCreateBrands: boolean
    autoCreateProducts: boolean
    autoCreateCategories: boolean
    requireImageForDraft: boolean
  }
  debug: {
    saveIntermediateFiles: boolean
    logLevel: 'debug' | 'info' | 'warn' | 'error'
  }
  rehearsal: {
    publishRehearsalMode: boolean
    publishRehearsalMaxRows: number
  }
  cropSuggestions: {
    enabled: boolean
    mode: 'brand_template_then_local_cv' | 'local_cv_only' | 'brand_template_only'
    autoApplyHighConfidenceTemplate: boolean
    minConfidenceToShow: number
    minConfidenceToRecommend: number
  }
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue
  const parsed = Number(value)
  return isNaN(parsed) ? defaultValue : parsed
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue
  return value.toLowerCase() === 'true' || value === '1'
}

export function loadEnvConfig(): AppConfig {
  const parseClamped = (val: string | undefined, def: number, min: number, max: number) => {
    const num = parseNumber(val, def)
    if (num < min || num > max) return def
    return num
  }

  return {
    supabase: {
      url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      anonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      storageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'offer-images',
      accessToken: process.env.SUPABASE_ACCESS_TOKEN
    },
    mistral: {
      apiKey: process.env.MISTRAL_API_KEY || '',
      ocrModel: process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest',
      ocrEndpoint: process.env.MISTRAL_OCR_ENDPOINT || 'https://api.mistral.ai/v1/ocr'
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      thinkingLevel: (process.env.GEMINI_THINKING_LEVEL as any) || 'HIGH',
      retryModel: process.env.GEMINI_RETRY_MODEL || 'gemini-4-argon',
      escalationModel: process.env.GEMINI_RETRY_MODEL || process.env.GEMINI_ESCALATION_MODEL || 'gemini-4-argon',
      executionMode: (process.env.GEMINI_EXECUTION_MODE as any) || 'standard',
      googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      gcpProjectId: process.env.GCP_PROJECT_ID,
      gcpLocation: process.env.GCP_LOCATION || 'global'
    },
    ocr: {
      chunkSize: parseClamped(process.env.OCR_CHUNK_SIZE, 1, 1, 3),
      maxConcurrentRequests: process.env.OCR_RATE_LIMIT_MODE === 'standard' ? parseClamped(process.env.OCR_MAX_CONCURRENT_REQUESTS, 1, 1, 4) : 1,
      maxRetries: parseClamped(process.env.OCR_MAX_RETRIES, 6, 0, 10),
      retryBaseDelayMs: parseNumber(process.env.OCR_RETRY_BASE_DELAY_MS, 3000),
      requestTimeoutMs: parseClamped(process.env.OCR_REQUEST_TIMEOUT_MS, 240000, 10000, 300000),
      confidenceGranularity: (process.env.OCR_CONFIDENCE_GRANULARITY === 'word' ? 'word' : 'page'),
      tableFormat: (process.env.OCR_TABLE_FORMAT === 'html' ? 'html' : process.env.OCR_TABLE_FORMAT === 'text' ? 'text' : 'markdown'),
      requestsPerSecondLimit: parseNumber(process.env.OCR_REQUESTS_PER_SECOND_LIMIT, 1),
      minRequestIntervalMs: Math.max(1000, parseNumber(process.env.OCR_ITEM_MIN_REQUEST_INTERVAL_MS || process.env.OCR_MIN_REQUEST_INTERVAL_MS, 1100)),
      tokensPerMinuteLimit: parseNumber(process.env.OCR_TOKENS_PER_MINUTE_LIMIT, 50000),
      tpmSafetyRatio: parseClamped(process.env.OCR_TPM_SAFETY_RATIO, 0.75, 0.1, 1.0),
      estimatedTokensPerPage: Math.max(100, parseNumber(process.env.OCR_ESTIMATED_TOKENS_PER_PAGE, 3000)),
      estimatedTokensPerDensePage: Math.max(100, parseNumber(process.env.OCR_ESTIMATED_TOKENS_PER_DENSE_PAGE, 5000)),
      rateLimitMode: process.env.OCR_RATE_LIMIT_MODE === 'standard' ? 'standard' : 'free_tier_safe'
    },
    pdf: {
      renderDpi: parseClamped(process.env.PDF_RENDER_DPI, 250, 100, 400)
    },
    images: {
      cropPaddingPercent: parseNumber(process.env.IMAGE_CROP_PADDING_PERCENT, 8),
      outputFormat: (['png', 'jpg', 'jpeg'].includes(process.env.IMAGE_OUTPUT_FORMAT || '') ? process.env.IMAGE_OUTPUT_FORMAT as any : 'webp'),
      outputQuality: parseNumber(process.env.IMAGE_OUTPUT_QUALITY, 85)
    },
    importBehavior: {
      defaultOfferDurationDays: parseNumber(process.env.DEFAULT_OFFER_DURATION_DAYS, 7),
      defaultOfferStatus: (['published', 'needs_review'].includes(process.env.DEFAULT_OFFER_STATUS || '') ? process.env.DEFAULT_OFFER_STATUS as any : process.env.DEFAULT_OFFER_STATUS === 'draft' ? 'needs_review' : 'needs_review'),
      importDefaultStatus: (process.env.IMPORT_DEFAULT_STATUS === 'needs_review' ? 'needs_review' : 'published'),
      allowNeedsReviewFallback: parseBoolean(process.env.ALLOW_NEEDS_REVIEW_FALLBACK, true),
      publishWarningsAllowed: parseBoolean(process.env.PUBLISH_WARNINGS_ALLOWED, true),
      lowConfidenceThreshold: parseNumber(process.env.LOW_CONFIDENCE_THRESHOLD, 0.75),
      dataQualityNeedsReviewThreshold: parseNumber(process.env.DATA_QUALITY_NEEDS_REVIEW_THRESHOLD, 70),
      skipDuplicateOffers: parseBoolean(process.env.SKIP_DUPLICATE_OFFERS, true),
      autoCreateBrands: parseBoolean(process.env.AUTO_CREATE_BRANDS, true),
      autoCreateProducts: parseBoolean(process.env.AUTO_CREATE_PRODUCTS, true),
      autoCreateCategories: parseBoolean(process.env.AUTO_CREATE_CATEGORIES, false),
      requireImageForDraft: parseBoolean(process.env.REQUIRE_IMAGE_FOR_DRAFT, false)
    },
    debug: {
      saveIntermediateFiles: parseBoolean(process.env.DEBUG_SAVE_INTERMEDIATE_FILES, false),
      logLevel: (['debug', 'info', 'warn', 'error'].includes(process.env.LOG_LEVEL || '') ? process.env.LOG_LEVEL as any : 'info')
    },
    rehearsal: {
      publishRehearsalMode: parseBoolean(process.env.PUBLISH_REHEARSAL_MODE, false),
      publishRehearsalMaxRows: parseNumber(process.env.PUBLISH_REHEARSAL_MAX_ROWS, 5)
    },
    cropSuggestions: {
      enabled: parseBoolean(process.env.CROP_SUGGESTIONS_ENABLED, true),
      mode: (['brand_template_then_local_cv', 'local_cv_only', 'brand_template_only'].includes(process.env.CROP_SUGGESTION_MODE || '') ? process.env.CROP_SUGGESTION_MODE as any : 'brand_template_then_local_cv'),
      autoApplyHighConfidenceTemplate: parseBoolean(process.env.AUTO_APPLY_HIGH_CONFIDENCE_TEMPLATE, false),
      minConfidenceToShow: parseNumber(process.env.MIN_CROP_SUGGESTION_CONFIDENCE_TO_SHOW, 0.35),
      minConfidenceToRecommend: parseNumber(process.env.MIN_CROP_SUGGESTION_CONFIDENCE_TO_RECOMMEND, 0.70)
    }
  }
}
