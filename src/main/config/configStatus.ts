import { loadEnvConfig } from './env'
import { SafeConfigStatus, ConfigKeyStatus } from '../../shared/types/config'
import { DatabaseEnvironmentStatus } from '../../shared/types/app'
import { resolveDatabaseConfig, PRODUCTION_PROJECT_REF } from '../db/databaseEnvironmentResolver'

function isValidUrl(urlStr: string): boolean {
  if (!urlStr) return false
  try {
    new URL(urlStr)
    return true
  } catch {
    return false
  }
}

function checkKey(value: string | undefined, required: boolean): ConfigKeyStatus {
  return {
    configured: !!value && value.trim() !== '',
    required
  }
}

export function getSafeConfigStatus(): SafeConfigStatus {
  const config = loadEnvConfig()
  const errors: string[] = []
  const warnings: string[] = []

  let databaseEnvironment: DatabaseEnvironmentStatus
  try {
    if (process.env.WIFRAN_DEV_UAT_HARNESS === '1') {
      const dbConfig = resolveDatabaseConfig('DEVELOPMENT_TEST')
      databaseEnvironment = {
        context: 'DEVELOPMENT_TEST',
        projectRef: dbConfig.projectRef,
        displayBadge: 'Database: DEVELOPMENT — TEST ONLY',
        isValidatedProduction: false
      }
    } else {
      const dbConfig = resolveDatabaseConfig('PRODUCTION_UI')
      databaseEnvironment = {
        context: 'PRODUCTION_UI',
        projectRef: dbConfig.projectRef,
        displayBadge: 'Database: PRODUCTION',
        isValidatedProduction: dbConfig.projectRef === PRODUCTION_PROJECT_REF
      }
    }
  } catch (err: any) {
    databaseEnvironment = {
      context: 'PRODUCTION_UI',
      projectRef: 'unknown',
      displayBadge: 'Database: MISCONFIGURED',
      isValidatedProduction: false,
      error: err?.message || String(err)
    }
    errors.push(`Database Environment Guard: ${err?.message || err}`)
  }

  // Check required keys
  if (!config.supabase.url) errors.push('SUPABASE_URL is missing')
  else if (!isValidUrl(config.supabase.url)) errors.push('SUPABASE_URL is not a valid URL')

  if (!config.supabase.serviceRoleKey) errors.push('SUPABASE_SERVICE_ROLE_KEY is missing')
  if (!config.supabase.storageBucket) errors.push('SUPABASE_STORAGE_BUCKET is missing')

  if (!config.supabase.anonKey) warnings.push('SUPABASE_ANON_KEY is missing (optional)')

  const isVertex = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GCP_PROJECT_ID);
  if (!isVertex && !config.gemini.apiKey && !config.mistral.apiKey) {
    errors.push('Vertex AI credentials (GOOGLE_APPLICATION_CREDENTIALS) or GEMINI_API_KEY is missing');
  }

  // Check numeric ranges
  if (config.ocr.chunkSize > 1) {
    warnings.push('OCR_CHUNK_SIZE is greater than 1. Dense leaflets may miss items. Use 1 for highest recall.')
  }
  if (config.ocr.maxConcurrentRequests > 2) {
    warnings.push('OCR_MAX_CONCURRENT_REQUESTS is greater than 2. This may increase rate-limit errors.')
  }
  
  if (config.ocr.rateLimitMode === 'free_tier_safe' && process.env.OCR_MAX_CONCURRENT_REQUESTS && Number(process.env.OCR_MAX_CONCURRENT_REQUESTS) > 1) {
    warnings.push('Free-tier safe mode forces OCR_MAX_CONCURRENT_REQUESTS=1 to avoid exceeding Mistral request limits.')
  }
  if (config.pdf.renderDpi < 200) {
    warnings.push('PDF_RENDER_DPI is below 200. Dense pages may be less readable.')
  }

  if (config.importBehavior.lowConfidenceThreshold < 0 || config.importBehavior.lowConfidenceThreshold > 1) errors.push('LOW_CONFIDENCE_THRESHOLD must be between 0 and 1')
  if (config.importBehavior.dataQualityNeedsReviewThreshold < 0 || config.importBehavior.dataQualityNeedsReviewThreshold > 100) errors.push('DATA_QUALITY_NEEDS_REVIEW_THRESHOLD must be between 0 and 100')

  return {
    databaseEnvironment,
    supabase: {
      url: checkKey(config.supabase.url, true),
      anonKey: checkKey(config.supabase.anonKey, false),
      serviceRoleKey: checkKey(config.supabase.serviceRoleKey, true),
      storageBucket: checkKey(config.supabase.storageBucket, true)
    },
    mistral: {
      apiKey: checkKey(isVertex ? 'vertex-configured' : (config.gemini.apiKey || config.mistral.apiKey), true),
      ocrModel: checkKey(config.gemini.model || config.mistral.ocrModel, true),
      ocrEndpoint: checkKey(isVertex ? 'https://aiplatform.googleapis.com' : (config.gemini.apiKey ? 'https://generativelanguage.googleapis.com' : config.mistral.ocrEndpoint), true)
    },
    ocr: {
      chunkSize: config.ocr.chunkSize,
      maxConcurrentRequests: config.ocr.maxConcurrentRequests,
      maxRetries: config.ocr.maxRetries,
      requestTimeoutMs: config.ocr.requestTimeoutMs,
      rateLimitMode: config.ocr.rateLimitMode,
      requestsPerSecondLimit: config.ocr.requestsPerSecondLimit,
      minRequestIntervalMs: config.ocr.minRequestIntervalMs,
      tokensPerMinuteLimit: config.ocr.tokensPerMinuteLimit,
      tpmSafetyRatio: config.ocr.tpmSafetyRatio
    },
    pdf: {
      renderDpi: config.pdf.renderDpi
    },
    images: {
      cropPaddingPercent: config.images.cropPaddingPercent,
      outputFormat: config.images.outputFormat,
      outputQuality: config.images.outputQuality
    },
    importBehavior: {
      defaultOfferDurationDays: config.importBehavior.defaultOfferDurationDays,
      defaultOfferStatus: config.importBehavior.defaultOfferStatus,
      importDefaultStatus: config.importBehavior.importDefaultStatus,
      allowNeedsReviewFallback: config.importBehavior.allowNeedsReviewFallback,
      publishWarningsAllowed: config.importBehavior.publishWarningsAllowed,
      lowConfidenceThreshold: config.importBehavior.lowConfidenceThreshold,
      dataQualityNeedsReviewThreshold: config.importBehavior.dataQualityNeedsReviewThreshold,
      skipDuplicateOffers: config.importBehavior.skipDuplicateOffers,
      autoCreateBrands: config.importBehavior.autoCreateBrands,
      autoCreateProducts: config.importBehavior.autoCreateProducts,
      autoCreateCategories: config.importBehavior.autoCreateCategories,
      requireImageForDraft: config.importBehavior.requireImageForDraft
    },
    debug: {
      saveIntermediateFiles: config.debug.saveIntermediateFiles,
      logLevel: config.debug.logLevel
    },
    validation: {
      ok: errors.length === 0,
      errors,
      warnings
    }
  }
}
