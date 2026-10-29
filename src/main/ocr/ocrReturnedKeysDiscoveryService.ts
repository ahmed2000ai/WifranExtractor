import fs from 'fs'
import path from 'path'
import { error as logError, warn } from '../logging/logger'

export type OcrReturnedKeyEntry = {
  key: string;
  first_value: unknown;
  first_seen_in_file: string;
  value_type: string;
};

export type OcrReturnedKeysRegistry = {
  keys: OcrReturnedKeyEntry[];
};

export type OcrKeyWithoutValueEntry = {
  key: string;
  first_seen_in_file: string;
  empty_values_seen: number;
};

export type OcrKeysWithoutValuesRegistry = {
  keys: OcrKeyWithoutValueEntry[];
};

class OcrReturnedKeysDiscoveryService {
  private queue: Promise<void> = Promise.resolve()

  private isValueEmpty(val: unknown): boolean {
    if (val === null || val === undefined) return true
    if (typeof val === 'string') {
      const trimmed = val.trim()
      if (trimmed === '') return true
      const lower = trimmed.toLowerCase()
      if (['n/a', 'na', 'none', 'null', 'unknown', 'not visible', 'not available', 'not shown', 'غير متوفر', 'غير واضح', 'غير مذكور'].includes(lower)) {
        return true
      }
      return false
    }
    if (Array.isArray(val) && val.length === 0) return true
    if (typeof val === 'object' && Object.keys(val as any).length === 0) return true
    return false
  }

  private validateAndRepairReturnedKeys(registry: any): OcrReturnedKeysRegistry {
    if (!registry || typeof registry !== 'object' || !Array.isArray(registry.keys)) {
      warn('ocr_returned_keys is invalid. Resetting.')
      return { keys: [] }
    }
    const validKeys: OcrReturnedKeyEntry[] = []
    const seen = new Set<string>()

    for (const entry of registry.keys) {
      if (typeof entry.key !== 'string' || !entry.key) continue
      if (seen.has(entry.key)) continue
      
      seen.add(entry.key)
      validKeys.push({
        key: entry.key,
        first_value: entry.first_value !== undefined ? entry.first_value : null,
        first_seen_in_file: typeof entry.first_seen_in_file === 'string' ? entry.first_seen_in_file : '',
        value_type: typeof entry.value_type === 'string' ? entry.value_type : typeof entry.first_value
      })
    }

    return { keys: validKeys }
  }

  private validateAndRepairKeysWithoutValues(registry: any): OcrKeysWithoutValuesRegistry {
    if (!registry || typeof registry !== 'object' || !Array.isArray(registry.keys)) {
      warn('ocr_keys_without_values is invalid. Resetting.')
      return { keys: [] }
    }
    const validKeys: OcrKeyWithoutValueEntry[] = []
    const seen = new Set<string>()

    for (const entry of registry.keys) {
      if (typeof entry.key !== 'string' || !entry.key) continue
      if (seen.has(entry.key)) continue
      
      seen.add(entry.key)
      validKeys.push({
        key: entry.key,
        first_seen_in_file: typeof entry.first_seen_in_file === 'string' ? entry.first_seen_in_file : '',
        empty_values_seen: typeof entry.empty_values_seen === 'number' ? entry.empty_values_seen : 1
      })
    }

    return { keys: validKeys }
  }

  public async updateRegistry(workspacePath: string, jsonPath: string, rawJson: Record<string, unknown>): Promise<{
    newKeysWithValues: string[],
    newKeysWithoutValues: string[]
  }> {
    return new Promise((resolve, reject) => {
      this.queue = this.queue.then(async () => {
        try {
          const returnedKeysPath = path.join(workspacePath, 'ocr_returned_keys.json')
          const keysWithoutValuesPath = path.join(workspacePath, 'ocr_keys_without_values.json')

          let returnedKeysRegistry: OcrReturnedKeysRegistry = { keys: [] }
          if (fs.existsSync(returnedKeysPath)) {
            try {
              returnedKeysRegistry = this.validateAndRepairReturnedKeys(JSON.parse(fs.readFileSync(returnedKeysPath, 'utf8')))
            } catch (err: any) {
              logError(`Failed to read ocr_returned_keys.json: ${err.message}`)
            }
          }

          let keysWithoutValuesRegistry: OcrKeysWithoutValuesRegistry = { keys: [] }
          if (fs.existsSync(keysWithoutValuesPath)) {
            try {
              keysWithoutValuesRegistry = this.validateAndRepairKeysWithoutValues(JSON.parse(fs.readFileSync(keysWithoutValuesPath, 'utf8')))
            } catch (err: any) {
              logError(`Failed to read ocr_keys_without_values.json: ${err.message}`)
            }
          }

          const relativeJsonPath = path.relative(workspacePath, jsonPath).replace(/\\/g, '/')
          
          const returnedKeysMap = new Map(returnedKeysRegistry.keys.map(k => [k.key, k]))
          const keysWithoutValuesMap = new Map(keysWithoutValuesRegistry.keys.map(k => [k.key, k]))

          const newKeysWithValues: string[] = []
          const newKeysWithoutValues: string[] = []

          for (const [key, value] of Object.entries(rawJson)) {
            if (!key) continue
            
            const isEmpty = this.isValueEmpty(value)

            if (!isEmpty) {
              if (!returnedKeysMap.has(key)) {
                // Add to returned keys
                returnedKeysMap.set(key, {
                  key,
                  first_value: value,
                  first_seen_in_file: relativeJsonPath,
                  value_type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
                })
                newKeysWithValues.push(key)

                // Remove from without values if it exists
                if (keysWithoutValuesMap.has(key)) {
                  keysWithoutValuesMap.delete(key)
                }
              }
            } else {
              if (!returnedKeysMap.has(key)) {
                // Add or update to without values
                if (keysWithoutValuesMap.has(key)) {
                  const entry = keysWithoutValuesMap.get(key)!
                  entry.empty_values_seen++
                } else {
                  keysWithoutValuesMap.set(key, {
                    key,
                    first_seen_in_file: relativeJsonPath,
                    empty_values_seen: 1
                  })
                  newKeysWithoutValues.push(key)
                }
              }
            }
          }

          // Atomic write back
          returnedKeysRegistry.keys = Array.from(returnedKeysMap.values())
          keysWithoutValuesRegistry.keys = Array.from(keysWithoutValuesMap.values())

          const tmpReturnedKeysPath = returnedKeysPath + '.tmp'
          fs.writeFileSync(tmpReturnedKeysPath, JSON.stringify(returnedKeysRegistry, null, 2), 'utf8')
          fs.renameSync(tmpReturnedKeysPath, returnedKeysPath)

          const tmpKeysWithoutValuesPath = keysWithoutValuesPath + '.tmp'
          fs.writeFileSync(tmpKeysWithoutValuesPath, JSON.stringify(keysWithoutValuesRegistry, null, 2), 'utf8')
          fs.renameSync(tmpKeysWithoutValuesPath, keysWithoutValuesPath)

          resolve({ newKeysWithValues, newKeysWithoutValues })
        } catch (err: any) {
          logError(`Failed to update OCR discovery registry: ${err.message}`)
          reject(err)
        }
      }).catch(reject)
    })
  }
}

export const ocrReturnedKeysDiscoveryService = new OcrReturnedKeysDiscoveryService()
