export type ConfigKeyStatus = {
  configured: boolean
  required: boolean
}

export type SafeConfigStatus = {
  supabase: {
    url: ConfigKeyStatus
    anonKey: ConfigKeyStatus
    serviceRoleKey: ConfigKeyStatus
    storageBucket: ConfigKeyStatus
  }
  mistral: {
    apiKey: ConfigKeyStatus
    ocrModel: ConfigKeyStatus
    ocrEndpoint: ConfigKeyStatus
  }
  ocr: {
    chunkSize: number
    maxConcurrentRequests: number
    maxRetries: number
    requestTimeoutMs: number
    rateLimitMode: 'free_tier_safe' | 'standard'
    requestsPerSecondLimit: number
    minRequestIntervalMs: number
    tokensPerMinuteLimit: number
    tpmSafetyRatio: number
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
  validation: {
    ok: boolean
    errors: string[]
    warnings: string[]
  }
}
