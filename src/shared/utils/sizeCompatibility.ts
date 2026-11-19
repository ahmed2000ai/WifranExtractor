/**
 * Strict Physical Size & Package Compatibility Engine
 * Milestone: WIFRAN-EXTRACTOR-CATALOG-MATCH-001A
 *
 * Implements mathematically exact measurement conversions and strict physical equality.
 * ZERO arbitrary percentage tolerance (no 5% or 15% loose windows).
 *
 * Requirements:
 * - 1L and 1000ml: compatible (exact unit conversion)
 * - 500g and 0.5kg: compatible (exact unit conversion)
 * - 950ml and 1L: NOT compatible (distinct commercial SKUs)
 * - 450g and 500g: NOT compatible (distinct commercial SKUs)
 * - 4x250ml manufacturer pack vs 1x1L container: distinct product identities
 * - Different flavors, fat levels, and manufacturer pack counts: distinct
 */

import { areMeasurementsEquivalent } from './unitEquivalence'

export interface SizeCompatibilityResult {
  isCompatible: boolean
  reason: string
}

export function areSizesStrictlyCompatible(
  val1: number | null | undefined,
  unit1: string | null | undefined,
  val2: number | null | undefined,
  unit2: string | null | undefined
): SizeCompatibilityResult {
  // If neither has size information, cannot prove conflict on size alone
  if ((val1 === null || val1 === undefined) && (val2 === null || val2 === undefined)) {
    return { isCompatible: true, reason: 'Both sizes unspecified' }
  }

  // If one has size and the other is missing, cannot assume compatibility safely
  if (val1 === null || val1 === undefined || val2 === null || val2 === undefined) {
    return {
      isCompatible: false,
      reason: `Asymmetric size information: offer=${val1 ?? 'unspecified'} ${unit1 ?? ''} vs product=${val2 ?? 'unspecified'} ${unit2 ?? ''}`
    }
  }

  // Check exact mathematical unit equivalence via canonical base units (ml for volume, g for mass)
  const equiv = areMeasurementsEquivalent(val1, unit1, val2, unit2)
  if (!equiv.isEquivalent) {
    return {
      isCompatible: false,
      reason: `Size mismatch: ${val1} ${unit1} is not mathematically equivalent to ${val2} ${unit2} (${equiv.reason})`
    }
  }

  return { isCompatible: true, reason: 'Sizes are mathematically equivalent' }
}

export function arePackConfigsStrictlyCompatible(params: {
  sizeValue1: number | null | undefined
  sizeUnit1: string | null | undefined
  packCount1: number | null | undefined
  sizeValue2: number | null | undefined
  sizeUnit2: string | null | undefined
  packCount2: number | null | undefined
}): SizeCompatibilityResult {
  const { sizeValue1, sizeUnit1, packCount1, sizeValue2, sizeUnit2, packCount2 } = params

  // 1. Pack counts must match strictly (e.g. 1 vs 4 is rejected)
  const p1 = packCount1 ?? 1
  const p2 = packCount2 ?? 1
  if (p1 !== p2) {
    return {
      isCompatible: false,
      reason: `Pack count mismatch: pack of ${p1} vs pack of ${p2}`
    }
  }

  // 2. Individual container sizes must be strictly compatible
  return areSizesStrictlyCompatible(sizeValue1, sizeUnit1, sizeValue2, sizeUnit2)
}

// Re-export package size and multipack safeguard engine
export * from './packageQuantitySafeguards'

