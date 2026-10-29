import pLimit from 'p-limit'
import { loadEnvConfig } from '../config/env'

export function getOcrConcurrencyLimit() {
  const config = loadEnvConfig()
  let limitValue = config.ocr.maxConcurrentRequests || 3
  
  if (limitValue < 1) limitValue = 1
  if (limitValue > 4) limitValue = 4

  return pLimit(limitValue)
}
