import * as fs from 'fs'
import * as path from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface OfferImageRefMap {
  nextSeq: number
  shortToUuid: Record<string, string>
  uuidToShort: Record<string, string>
}

let activeCustomMapPath: string | null = null

export function getDefaultOfferRefMapPath(): string {
  return path.join(process.cwd(), 'exports', 'offer-image-ref-map.json')
}

export function setCustomOfferRefMapPath(customPath: string | null): void {
  activeCustomMapPath = customPath
}

export function getOfferRefMapPath(overridePath?: string): string {
  return overridePath || activeCustomMapPath || getDefaultOfferRefMapPath()
}

/**
 * Loads the local Offer Ref JSON map from disk.
 * Returns a fresh map structure if the file does not exist or contains invalid JSON.
 */
export async function loadOfferRefMap(filePath?: string): Promise<OfferImageRefMap> {
  const targetPath = getOfferRefMapPath(filePath)
  try {
    const raw = await fs.promises.readFile(targetPath, 'utf8')
    const parsed = JSON.parse(raw)
    const nextSeq =
      typeof parsed?.nextSeq === 'number' && Number.isInteger(parsed.nextSeq) && parsed.nextSeq >= 1
        ? parsed.nextSeq
        : 1
    const shortToUuid =
      typeof parsed?.shortToUuid === 'object' && parsed.shortToUuid !== null ? parsed.shortToUuid : {}
    const uuidToShort =
      typeof parsed?.uuidToShort === 'object' && parsed.uuidToShort !== null ? parsed.uuidToShort : {}

    return { nextSeq, shortToUuid, uuidToShort }
  } catch (err: any) {
    return {
      nextSeq: 1,
      shortToUuid: {},
      uuidToShort: {}
    }
  }
}

/**
 * Persists the Offer Ref map to disk atomically.
 * Automatically resets nextSeq = 1 if all mappings have been cleared.
 */
export async function saveOfferRefMap(map: OfferImageRefMap, filePath?: string): Promise<void> {
  const targetPath = getOfferRefMapPath(filePath)

  if (Object.keys(map.shortToUuid).length === 0) {
    map.nextSeq = 1
    map.uuidToShort = {}
  }

  const dir = path.dirname(targetPath)
  await fs.promises.mkdir(dir, { recursive: true })
  await fs.promises.writeFile(targetPath, JSON.stringify(map, null, 2), 'utf8')
}

/**
 * Assigns an O<n> short reference for an offer UUID.
 * Reuses existing short reference if already mapped.
 */
export function assignShortOfferRef(uuid: string, map: OfferImageRefMap): string {
  const normalizedUuid = uuid.trim().toLowerCase()
  if (map.uuidToShort[normalizedUuid]) {
    return map.uuidToShort[normalizedUuid]
  }

  while (map.shortToUuid[`O${map.nextSeq}`]) {
    map.nextSeq++
  }

  const shortRef = `O${map.nextSeq}`
  map.nextSeq++
  map.shortToUuid[shortRef] = normalizedUuid
  map.uuidToShort[normalizedUuid] = shortRef
  return shortRef
}

/**
 * Removes an offer mapping (by short reference or UUID).
 * Automatically resets nextSeq = 1 when the map becomes empty.
 */
export function removeOfferRef(identifier: string, map: OfferImageRefMap): boolean {
  if (!identifier) return false
  const trimmed = identifier.trim()
  let changed = false

  // 1. If identifier is short ref (e.g. O1)
  const upper = trimmed.toUpperCase()
  if (upper.startsWith('O') && map.shortToUuid[upper]) {
    const uuid = map.shortToUuid[upper]
    delete map.shortToUuid[upper]
    if (uuid && map.uuidToShort[uuid]) {
      delete map.uuidToShort[uuid]
    }
    changed = true
  }

  // 2. If identifier is UUID
  const lower = trimmed.toLowerCase()
  if (map.uuidToShort[lower]) {
    const shortRef = map.uuidToShort[lower]
    delete map.uuidToShort[lower]
    if (shortRef && map.shortToUuid[shortRef]) {
      delete map.shortToUuid[shortRef]
    }
    changed = true
  }

  // 3. Fallback check: any shortToUuid value matching lower UUID
  for (const [sKey, uVal] of Object.entries(map.shortToUuid)) {
    if (uVal.toLowerCase() === lower) {
      delete map.shortToUuid[sKey]
      changed = true
    }
  }

  if (Object.keys(map.shortToUuid).length === 0) {
    map.nextSeq = 1
    map.uuidToShort = {}
  }

  return changed
}

/**
 * Prunes stale entries from the local map whose offers already have an approved image
 * in public.offer_display_images or are now linked to a verified catalog product.
 */
export async function pruneStaleOfferRefs(
  map: OfferImageRefMap,
  supabase: SupabaseClient
): Promise<number> {
  const mappedUuids = Array.from(new Set(Object.values(map.shortToUuid)))
  if (mappedUuids.length === 0) return 0

  // 1. Check approved images
  const { data: approvedImages } = await supabase
    .from('offer_display_images')
    .select('offer_id')
    .in('offer_id', mappedUuids)
    .eq('approval_status', 'approved')

  const approvedIds = new Set((approvedImages || []).map((img: any) => img.offer_id))

  // 2. Check offer catalog link / existence
  const { data: existingOffers } = await supabase
    .from('offers')
    .select('id, product_id')
    .in('id', mappedUuids)

  const existingOfferMap = new Map((existingOffers || []).map((o: any) => [o.id, o]))

  let prunedCount = 0
  for (const uuid of mappedUuids) {
    const offerRecord = existingOfferMap.get(uuid)
    const hasApprovedImage = approvedIds.has(uuid)
    const isLinkedToProduct = offerRecord && offerRecord.product_id !== null
    const noLongerExists = !offerRecord

    if (hasApprovedImage || isLinkedToProduct || noLongerExists) {
      removeOfferRef(uuid, map)
      prunedCount++
    }
  }

  if (Object.keys(map.shortToUuid).length === 0) {
    map.nextSeq = 1
    map.uuidToShort = {}
  }

  return prunedCount
}

export interface ParsedImageRef {
  rawRef: string
  kind: 'product' | 'offer' | 'unknown'
  productId?: number
  offerId?: string
  shortRef?: string
  isShortOfferRef?: boolean
  error?: string
}

/**
 * Deterministic Image_Ref parser supporting:
 * - Product: P<id> or positive integer
 * - Offer Short: O<seq> (e.g. O1, O2) resolved via OfferImageRefMap
 * - Offer Full: O<uuid> or bare <uuid>
 */
export function parseImageRef(rawRef: string, map?: OfferImageRefMap): ParsedImageRef {
  const trimmed = (rawRef || '').trim()
  if (!trimmed) {
    return { rawRef, kind: 'unknown', error: 'Missing Image_Ref / Product_ID.' }
  }

  // 1. Product reference: P<id> or positive integer
  if (trimmed.toUpperCase().startsWith('P')) {
    const num = Number(trimmed.slice(1).trim())
    if (Number.isInteger(num) && num > 0) {
      return { rawRef, kind: 'product', productId: num }
    }
    return {
      rawRef,
      kind: 'product',
      error: `Product ID in reference '${rawRef}' must be a positive integer.`
    }
  }

  if (Number.isInteger(Number(trimmed)) && Number(trimmed) > 0) {
    return { rawRef, kind: 'product', productId: Number(trimmed) }
  }

  // 2. Offer reference: O<seq> or O<uuid> or bare <uuid>
  if (trimmed.toUpperCase().startsWith('O')) {
    const afterO = trimmed.slice(1).trim()

    // 2a. Short sequential format: O1, O2, O3...
    const shortMatch = afterO.match(/^([1-9]\d*)$/)
    if (shortMatch) {
      const canonicalShort = `O${shortMatch[1]}`
      const mappedUuid = map?.shortToUuid?.[canonicalShort]
      if (mappedUuid) {
        return {
          rawRef,
          kind: 'offer',
          offerId: mappedUuid,
          shortRef: canonicalShort,
          isShortOfferRef: true
        }
      }
      return {
        rawRef,
        kind: 'offer',
        shortRef: canonicalShort,
        isShortOfferRef: true,
        error: `Unmapped or expired short offer reference '${rawRef}'. Ensure the local offer ref map is up to date or re-export Step 1.`
      }
    }

    // 2b. Full UUID format: O<36-char-uuid>
    const uuidMatch = afterO.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
    if (uuidMatch) {
      return {
        rawRef,
        kind: 'offer',
        offerId: uuidMatch[1].toLowerCase(),
        isShortOfferRef: false
      }
    }

    return {
      rawRef,
      kind: 'offer',
      error: `Invalid offer reference '${rawRef}'. Expected short sequential ('O1', 'O2') or full UUID format ('O<uuid>').`
    }
  }

  // 2c. Bare UUID format: <uuid>
  const bareUuidMatch = trimmed.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  if (bareUuidMatch) {
    return {
      rawRef,
      kind: 'offer',
      offerId: bareUuidMatch[1].toLowerCase(),
      isShortOfferRef: false
    }
  }

  return {
    rawRef,
    kind: 'unknown',
    error: `Unrecognized reference format '${rawRef}'. Expected 'P<id>' for products or 'O<n>' / 'O<uuid>' for offers.`
  }
}

