/**
 * Persistent Verified-Match Cache Service
 * Milestone: WIFRAN-EXTRACTOR-CATALOG-MATCH-001
 *
 * Implements a durable, file-backed cache for operator-verified and catalog-proven
 * product matches. Survives app restarts, batches, and leaflets.
 * Strictly separates PRODUCTION and DEVELOPMENT environments.
 * $0 API cost, zero network overhead on cache hits.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import {
  NormalizedIdentityAttributes,
  PersistentVerifiedMatchRecord
} from '../../shared/types/catalogMatching'
import { normalizeArabicText, normalizeEnglishText } from '../../shared/utils/textNormalization'
import { canonicalizeUnit } from '../../shared/utils/priceAndUnitNormalizer'
import { arePackConfigsStrictlyCompatible } from '../../shared/utils/sizeCompatibility'
import { evaluateIdentitySufficiency } from './productIdentityPolicy'

export interface CacheStore {
  version: '1.0'
  environment: 'production' | 'development'
  records: Record<string, PersistentVerifiedMatchRecord>
}

export class VerifiedMatchCacheService {
  private cacheDir: string
  private cacheFilePath: string
  private environment: 'production' | 'development'
  private store: CacheStore | null = null

  constructor(baseDir?: string, environment: 'production' | 'development' = 'production') {
    this.cacheDir = baseDir || join(process.cwd(), 'Extracts', 'cache')
    this.environment = environment
    this.cacheFilePath = join(this.cacheDir, `verified-matches-${environment}.json`)
  }

  /**
   * Deterministically computes a collision-resistant identity fingerprint
   * based purely on product identity attributes (excluding retailer/promo info).
   */
  public computeFingerprint(attrs: NormalizedIdentityAttributes): string {
    const normBrand = (attrs.brandKey || 'unknown').toLowerCase().trim()
    const normAr = normalizeArabicText(attrs.productNameAr || '')
    const normEn = normalizeEnglishText(attrs.productNameEn || '')
    const normVariant = normalizeEnglishText(attrs.variantOrFlavor || '')
    const normFat = normalizeEnglishText(attrs.fatContent || '')
    const sizeVal = attrs.eachSizeValue !== null && attrs.eachSizeValue !== undefined ? Number(attrs.eachSizeValue).toFixed(3) : 'null'
    const sizeUnit = attrs.eachSizeUnit ? canonicalizeUnit(attrs.eachSizeUnit) : 'null'
    const mfgPack = attrs.manufacturerPackCount ?? attrs.innerPackCount ?? 1
    const pack = String(mfgPack)
    const form = attrs.productForm ? attrs.productForm.toLowerCase().trim() : 'null'

    const payload = `${normBrand}|${normAr}|${normEn}|${normVariant}|${normFat}|${sizeVal}|${sizeUnit}|${pack}|${form}`
    return createHash('sha256').update(payload).digest('hex')
  }

  private loadStore(): CacheStore {
    if (this.store) return this.store

    if (existsSync(this.cacheFilePath)) {
      try {
        const raw = readFileSync(this.cacheFilePath, 'utf8')
        const parsed = JSON.parse(raw) as CacheStore
        if (parsed && parsed.version === '1.0' && parsed.environment === this.environment) {
          this.store = parsed
          return this.store
        }
      } catch (err) {
        console.warn(`[VerifiedMatchCache] Error reading cache file ${this.cacheFilePath}, resetting.`, err)
      }
    }

    this.store = {
      version: '1.0',
      environment: this.environment,
      records: {}
    }
    return this.store
  }

  private persistStore(): void {
    if (!this.store) return
    try {
      if (!existsSync(this.cacheDir)) {
        mkdirSync(this.cacheDir, { recursive: true })
      }
      const tmpPath = `${this.cacheFilePath}.tmp.${Date.now()}`
      writeFileSync(tmpPath, JSON.stringify(this.store, null, 2), 'utf8')
      const fs = require('fs')
      fs.renameSync(tmpPath, this.cacheFilePath)
    } catch (err) {
      console.error(`[VerifiedMatchCache] Failed to persist cache file ${this.cacheFilePath}`, err)
    }
  }

  /**
   * Look up a previously verified product match by identity attributes.
   * Returns approved permanent product ID if found and verified.
   */
  public lookupVerifiedMatch(
    attrs: NormalizedIdentityAttributes,
    liveCatalogProduct?: { id: string; verification_status?: string; is_active?: boolean } | null
  ): PersistentVerifiedMatchRecord | null {
    // Safety gate: never auto-match ambiguous, assorted, or insufficient identities from cache
    const sufficiency = evaluateIdentitySufficiency(attrs)
    if (!sufficiency.isSufficient) return null

    const store = this.loadStore()
    const fingerprint = this.computeFingerprint(attrs)
    const record = store.records[fingerprint]

    if (!record) return null

    // Cache safety check: Mathematically exact size and manufacturer pack compatibility
    const mfgPack = attrs.manufacturerPackCount ?? attrs.innerPackCount ?? 1
    const packCompat = arePackConfigsStrictlyCompatible({
      sizeValue1: attrs.eachSizeValue,
      sizeUnit1: attrs.eachSizeUnit,
      packCount1: mfgPack,
      sizeValue2: record.sizeValue,
      sizeUnit2: record.sizeUnit,
      packCount2: record.packCount
    })
    if (!packCompat.isCompatible) return null

    // Cache safety check: Revalidate against live catalog product if provided
    if (liveCatalogProduct !== undefined) {
      const isValid = this.revalidateWithCatalog(record, liveCatalogProduct)
      if (!isValid) return null
    }

    return record
  }

  /**
   * Revalidates a cached match against current database state.
   * Invalidates stale entries if product was deleted, deactivated, or unverified.
   */
  public revalidateWithCatalog(
    record: PersistentVerifiedMatchRecord,
    liveProduct?: { id: string; verification_status?: string; is_active?: boolean } | null
  ): boolean {
    if (!liveProduct) {
      this.invalidateProductId(record.approvedProductId)
      return false
    }
    if (liveProduct.verification_status && liveProduct.verification_status !== 'verified') {
      this.invalidateProductId(record.approvedProductId)
      return false
    }
    if (liveProduct.is_active === false) {
      this.invalidateProductId(record.approvedProductId)
      return false
    }
    return true
  }

  /**
   * Save an operator-verified or approved catalog match into the persistent cache.
   * Only approved / verified decisions may be added (NEVER unverified LLM proposals).
   */
  public recordVerifiedMatch(params: {
    attrs: NormalizedIdentityAttributes
    approvedProductId: string
    verifiedBy: string
    catalogVersion?: string
  }): PersistentVerifiedMatchRecord {
    const sufficiency = evaluateIdentitySufficiency(params.attrs)
    if (!sufficiency.isSufficient) {
      throw new Error(
        `UNSAFE_VERIFIED_CACHE_WRITE: Refusing to cache insufficient/ambiguous identity (${sufficiency.reasons.join(' ')})`
      )
    }

    const store = this.loadStore()
    const fingerprint = this.computeFingerprint(params.attrs)
    const mfgPack = params.attrs.manufacturerPackCount ?? params.attrs.innerPackCount ?? 1

    const record: PersistentVerifiedMatchRecord = {
      identityFingerprint: fingerprint,
      brandKey: params.attrs.brandKey,
      productNameNorm: params.attrs.productNameEn || params.attrs.productNameAr,
      sizeValue: params.attrs.eachSizeValue,
      sizeUnit: params.attrs.eachSizeUnit ? canonicalizeUnit(params.attrs.eachSizeUnit) : null,
      packCount: mfgPack,
      variantOrFlavor: params.attrs.variantOrFlavor,
      fatContent: params.attrs.fatContent,
      approvedProductId: String(params.approvedProductId),
      verifiedAt: new Date().toISOString(),
      verifiedBy: params.attrs.brandKey ? params.verifiedBy : 'system_verified',
      environment: this.environment,
      catalogVersion: params.catalogVersion
    }

    store.records[fingerprint] = record
    this.persistStore()
    return record
  }

  /**
   * Invalidate a single cached identity (e.g. if an operator rejects a match
   * or a catalog product is altered/deleted).
   */
  public invalidateMatch(attrs: NormalizedIdentityAttributes): boolean {
    const store = this.loadStore()
    const fingerprint = this.computeFingerprint(attrs)
    if (store.records[fingerprint]) {
      delete store.records[fingerprint]
      this.persistStore()
      return true
    }
    return false
  }

  /**
   * Invalidate all matches for a specific product ID.
   */
  public invalidateProductId(productId: string): number {
    const store = this.loadStore()
    let count = 0
    const strId = String(productId)
    for (const [key, rec] of Object.entries(store.records)) {
      if (rec.approvedProductId === strId) {
        delete store.records[key]
        count++
      }
    }
    if (count > 0) {
      this.persistStore()
    }
    return count
  }

  /**
   * Clear the entire cache for testing or maintenance.
   */
  public clear(): void {
    this.store = {
      version: '1.0',
      environment: this.environment,
      records: {}
    }
    this.persistStore()
  }

  public getRecordCount(): number {
    const store = this.loadStore()
    return Object.keys(store.records).length
  }
}
