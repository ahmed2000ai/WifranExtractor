import fs from 'fs'
import path from 'path'
import { OcrReturnedKeysRegistry, normalizeOcrKey } from '../../shared/utils/ocrKeyCanonicalization'
import { error as logError, warn } from '../logging/logger'

const SEED_REGISTRY: OcrReturnedKeysRegistry = {
  keys: [
    { canonical_key: "product_name_ar", aliases_seen: ["name_ar", "arabic_name", "product_ar", "arabic_product_name"] },
    { canonical_key: "product_name_en", aliases_seen: ["name_en", "english_name", "product_en", "english_product_name"] },
    { canonical_key: "description_ar", aliases_seen: ["arabic_description", "desc_ar"] },
    { canonical_key: "description_en", aliases_seen: ["english_description", "desc_en"] },
    { canonical_key: "offer_price", aliases_seen: ["price", "sale_price", "current_price", "promo_price", "promotion_price", "discounted_price"] },
    { canonical_key: "original_price", aliases_seen: ["old_price", "was_price", "before_price", "regular_price", "previous_price"] },
    { canonical_key: "currency", aliases_seen: ["currency_code"] },
    { canonical_key: "size", aliases_seen: ["pack_size", "package_size", "net_weight", "weight", "volume"] },
    { canonical_key: "unit", aliases_seen: ["measurement_unit"] },
    { canonical_key: "pack_quantity", aliases_seen: ["quantity", "qty", "pieces", "piece_count", "unit_count", "count"] },
    { canonical_key: "bundle_quantity", aliases_seen: ["bundle_count", "multi_buy_quantity", "total_bundle_quantity"] },
    { canonical_key: "special_offer", aliases_seen: ["promotion", "promo", "offer_condition", "deal", "deal_text", "buy_get", "bundle_deal"] },
    { canonical_key: "price_condition", aliases_seen: ["per_unit_condition", "price_unit", "per_pack", "per_kg", "per_box"] },
    { canonical_key: "flavor", aliases_seen: ["flavour", "taste"] },
    { canonical_key: "variant", aliases_seen: ["product_variant"] },
    { canonical_key: "country_of_origin", aliases_seen: ["origin", "made_in"] },
    { canonical_key: "storage_condition", aliases_seen: ["storage", "keep_condition"] }
  ]
}

class OcrReturnedKeysRegistryService {
  private queue: Promise<void> = Promise.resolve()

  private validateAndRepairRegistry(registry: any): OcrReturnedKeysRegistry {
    if (!registry || typeof registry !== 'object' || !Array.isArray(registry.keys)) {
      warn('Registry is invalid or missing keys array. Repairing from seed.')
      return JSON.parse(JSON.stringify(SEED_REGISTRY))
    }

    const validKeys: OcrReturnedKeysRegistry['keys'] = []
    const knownCanonical = new Set<string>()

    for (const entry of registry.keys) {
      if (!entry.canonical_key || typeof entry.canonical_key !== 'string') continue
      
      const canonical = normalizeOcrKey(entry.canonical_key)
      if (!canonical || knownCanonical.has(canonical)) continue
      
      knownCanonical.add(canonical)

      const aliases = new Set<string>()
      if (Array.isArray(entry.aliases_seen)) {
        for (const alias of entry.aliases_seen) {
          if (typeof alias === 'string') {
            const normAlias = normalizeOcrKey(alias)
            if (normAlias && normAlias !== canonical) {
              aliases.add(normAlias)
            }
          }
        }
      }
      validKeys.push({ canonical_key: canonical, aliases_seen: Array.from(aliases) })
    }

    return { keys: validKeys }
  }

  private mergeRegistries(base: OcrReturnedKeysRegistry, newKeys: string[], newAliases: Array<{ alias: string, canonicalKey: string }>): OcrReturnedKeysRegistry {
    const registry = JSON.parse(JSON.stringify(base)) as OcrReturnedKeysRegistry
    const keyMap = new Map<string, typeof registry.keys[0]>()

    // Build map
    for (const entry of registry.keys) {
      keyMap.set(entry.canonical_key, entry)
    }

    // Add new canonical keys
    for (const nk of newKeys) {
      if (!keyMap.has(nk)) {
        const newEntry = { canonical_key: nk, aliases_seen: [] }
        registry.keys.push(newEntry)
        keyMap.set(nk, newEntry)
      }
    }

    // Add new aliases
    for (const { alias, canonicalKey } of newAliases) {
      const entry = keyMap.get(canonicalKey)
      if (entry && !entry.aliases_seen.includes(alias)) {
        entry.aliases_seen.push(alias)
      }
    }

    // Remove duplicates across the whole registry
    const seenAliases = new Set<string>()
    for (const entry of registry.keys) {
      seenAliases.add(entry.canonical_key)
    }

    for (const entry of registry.keys) {
      entry.aliases_seen = entry.aliases_seen.filter(alias => {
        if (seenAliases.has(alias)) return false // already canonical somewhere else or seen before
        seenAliases.add(alias)
        return true
      })
    }

    return registry
  }

  public async updateRegistry(workspacePath: string, newKeys: string[], aliasesUsed: Array<{ alias: string, canonicalKey: string }>): Promise<OcrReturnedKeysRegistry> {
    return new Promise((resolve, reject) => {
      this.queue = this.queue.then(async () => {
        try {
          const registryPath = path.join(workspacePath, 'ocr_returned_keys.json')
          let currentRegistry: OcrReturnedKeysRegistry

          if (fs.existsSync(registryPath)) {
            try {
              const raw = fs.readFileSync(registryPath, 'utf8')
              currentRegistry = this.validateAndRepairRegistry(JSON.parse(raw))
            } catch (err: any) {
              logError(`Failed to read registry: ${err.message}. Re-seeding.`)
              currentRegistry = JSON.parse(JSON.stringify(SEED_REGISTRY))
            }
          } else {
            currentRegistry = JSON.parse(JSON.stringify(SEED_REGISTRY))
          }

          // Merge seeds first to ensure it's always robust
          currentRegistry = this.mergeRegistries(currentRegistry, SEED_REGISTRY.keys.map(k => k.canonical_key), SEED_REGISTRY.keys.flatMap(k => k.aliases_seen.map(a => ({ alias: a, canonicalKey: k.canonical_key }))))
          
          // Merge actual new items
          const updatedRegistry = this.mergeRegistries(currentRegistry, newKeys, aliasesUsed)

          // Write atomically
          const tmpPath = registryPath + '.tmp'
          fs.writeFileSync(tmpPath, JSON.stringify(updatedRegistry, null, 2), 'utf8')
          fs.renameSync(tmpPath, registryPath)

          resolve(updatedRegistry)
        } catch (err: any) {
          logError(`Failed to update OCR returned keys registry: ${err.message}`)
          reject(err)
        }
      }).catch(reject)
    })
  }

  public async getRegistry(workspacePath: string): Promise<OcrReturnedKeysRegistry> {
    return new Promise((resolve, reject) => {
      this.queue = this.queue.then(async () => {
        try {
          const registryPath = path.join(workspacePath, 'ocr_returned_keys.json')
          let currentRegistry: OcrReturnedKeysRegistry

          if (fs.existsSync(registryPath)) {
            try {
              const raw = fs.readFileSync(registryPath, 'utf8')
              currentRegistry = this.validateAndRepairRegistry(JSON.parse(raw))
            } catch (err: any) {
              currentRegistry = JSON.parse(JSON.stringify(SEED_REGISTRY))
            }
          } else {
            currentRegistry = JSON.parse(JSON.stringify(SEED_REGISTRY))
          }

          resolve(currentRegistry)
        } catch (err) {
          reject(err)
        }
      }).catch(reject)
    })
  }
}

export const ocrReturnedKeysRegistryService = new OcrReturnedKeysRegistryService()
