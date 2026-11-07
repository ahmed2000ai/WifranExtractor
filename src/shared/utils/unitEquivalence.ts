/**
 * Safe, Deterministic Measurement-Unit Normalization and Equivalence Engine
 * Milestone 2A: WIFRAN-EXTRACTOR-IDENTITY-002A
 *
 * Provides mathematically exact measurement conversions and equivalence checks
 * within compatible physical dimensions (mass, volume, count, length, sheet, roll).
 * Strictly prevents cross-dimensional conversion (e.g. mass vs volume) and maintains
 * precision without loose floating-point tolerances.
 */

import { normalizeArabicNumerals } from './priceAndUnitNormalizer'

export type MeasurementDimension = 'mass' | 'volume' | 'count' | 'length' | 'sheet' | 'roll' | 'other'

export interface CanonicalMeasurement {
  rawValue: number
  rawUnit: string
  canonicalUnit: string
  dimension: MeasurementDimension
  baseValue: number // scaled to canonical base unit (g for mass, ml for volume, pcs for count)
  baseUnit: string  // 'g', 'ml', 'pcs', 'm', 'sheet', 'roll'
  isRecognized: boolean
}

export interface UnitEquivalenceResult {
  isEquivalent: boolean
  isDimensionCompatible: boolean
  reason: string
  offerMeasurement?: CanonicalMeasurement | null
  productMeasurement?: CanonicalMeasurement | null
}

interface UnitSpec {
  canonicalUnit: string
  dimension: MeasurementDimension
  multiplierToBase: number
  baseUnit: string
}

// Fixed comparison epsilon in base units (0.0001 = 0.1 mg or 0.1 microliter)
export const EQUIVALENCE_EPSILON = 1e-4

/**
 * Static registry of recognized measurement units across English and Arabic variants.
 */
const UNIT_LOOKUP: Record<string, UnitSpec> = {
  // Volume units (Base: ml)
  l: { canonicalUnit: 'l', dimension: 'volume', multiplierToBase: 1000, baseUnit: 'ml' },
  lt: { canonicalUnit: 'l', dimension: 'volume', multiplierToBase: 1000, baseUnit: 'ml' },
  ltr: { canonicalUnit: 'l', dimension: 'volume', multiplierToBase: 1000, baseUnit: 'ml' },
  liter: { canonicalUnit: 'l', dimension: 'volume', multiplierToBase: 1000, baseUnit: 'ml' },
  litre: { canonicalUnit: 'l', dimension: 'volume', multiplierToBase: 1000, baseUnit: 'ml' },
  liters: { canonicalUnit: 'l', dimension: 'volume', multiplierToBase: 1000, baseUnit: 'ml' },
  litres: { canonicalUnit: 'l', dimension: 'volume', multiplierToBase: 1000, baseUnit: 'ml' },
  لتر: { canonicalUnit: 'l', dimension: 'volume', multiplierToBase: 1000, baseUnit: 'ml' },
  ليتر: { canonicalUnit: 'l', dimension: 'volume', multiplierToBase: 1000, baseUnit: 'ml' },
  ل: { canonicalUnit: 'l', dimension: 'volume', multiplierToBase: 1000, baseUnit: 'ml' },

  ml: { canonicalUnit: 'ml', dimension: 'volume', multiplierToBase: 1, baseUnit: 'ml' },
  mls: { canonicalUnit: 'ml', dimension: 'volume', multiplierToBase: 1, baseUnit: 'ml' },
  milli: { canonicalUnit: 'ml', dimension: 'volume', multiplierToBase: 1, baseUnit: 'ml' },
  milliliter: { canonicalUnit: 'ml', dimension: 'volume', multiplierToBase: 1, baseUnit: 'ml' },
  millilitre: { canonicalUnit: 'ml', dimension: 'volume', multiplierToBase: 1, baseUnit: 'ml' },
  milliliters: { canonicalUnit: 'ml', dimension: 'volume', multiplierToBase: 1, baseUnit: 'ml' },
  millilitres: { canonicalUnit: 'ml', dimension: 'volume', multiplierToBase: 1, baseUnit: 'ml' },
  مل: { canonicalUnit: 'ml', dimension: 'volume', multiplierToBase: 1, baseUnit: 'ml' },
  ملي: { canonicalUnit: 'ml', dimension: 'volume', multiplierToBase: 1, baseUnit: 'ml' },
  ملل: { canonicalUnit: 'ml', dimension: 'volume', multiplierToBase: 1, baseUnit: 'ml' },
  ملم: { canonicalUnit: 'ml', dimension: 'volume', multiplierToBase: 1, baseUnit: 'ml' },

  cl: { canonicalUnit: 'cl', dimension: 'volume', multiplierToBase: 10, baseUnit: 'ml' },
  cls: { canonicalUnit: 'cl', dimension: 'volume', multiplierToBase: 10, baseUnit: 'ml' },
  centiliter: { canonicalUnit: 'cl', dimension: 'volume', multiplierToBase: 10, baseUnit: 'ml' },
  centilitre: { canonicalUnit: 'cl', dimension: 'volume', multiplierToBase: 10, baseUnit: 'ml' },
  سنتيلتر: { canonicalUnit: 'cl', dimension: 'volume', multiplierToBase: 10, baseUnit: 'ml' },
  سل: { canonicalUnit: 'cl', dimension: 'volume', multiplierToBase: 10, baseUnit: 'ml' },

  dl: { canonicalUnit: 'dl', dimension: 'volume', multiplierToBase: 100, baseUnit: 'ml' },
  deciliter: { canonicalUnit: 'dl', dimension: 'volume', multiplierToBase: 100, baseUnit: 'ml' },
  decilitre: { canonicalUnit: 'dl', dimension: 'volume', multiplierToBase: 100, baseUnit: 'ml' },

  // Mass units (Base: g)
  kg: { canonicalUnit: 'kg', dimension: 'mass', multiplierToBase: 1000, baseUnit: 'g' },
  kgs: { canonicalUnit: 'kg', dimension: 'mass', multiplierToBase: 1000, baseUnit: 'g' },
  kilo: { canonicalUnit: 'kg', dimension: 'mass', multiplierToBase: 1000, baseUnit: 'g' },
  kilogram: { canonicalUnit: 'kg', dimension: 'mass', multiplierToBase: 1000, baseUnit: 'g' },
  kilograms: { canonicalUnit: 'kg', dimension: 'mass', multiplierToBase: 1000, baseUnit: 'g' },
  كيلو: { canonicalUnit: 'kg', dimension: 'mass', multiplierToBase: 1000, baseUnit: 'g' },
  كجم: { canonicalUnit: 'kg', dimension: 'mass', multiplierToBase: 1000, baseUnit: 'g' },
  كغ: { canonicalUnit: 'kg', dimension: 'mass', multiplierToBase: 1000, baseUnit: 'g' },
  كيلوغرام: { canonicalUnit: 'kg', dimension: 'mass', multiplierToBase: 1000, baseUnit: 'g' },

  g: { canonicalUnit: 'g', dimension: 'mass', multiplierToBase: 1, baseUnit: 'g' },
  gm: { canonicalUnit: 'g', dimension: 'mass', multiplierToBase: 1, baseUnit: 'g' },
  gms: { canonicalUnit: 'g', dimension: 'mass', multiplierToBase: 1, baseUnit: 'g' },
  grm: { canonicalUnit: 'g', dimension: 'mass', multiplierToBase: 1, baseUnit: 'g' },
  gram: { canonicalUnit: 'g', dimension: 'mass', multiplierToBase: 1, baseUnit: 'g' },
  grams: { canonicalUnit: 'g', dimension: 'mass', multiplierToBase: 1, baseUnit: 'g' },
  غ: { canonicalUnit: 'g', dimension: 'mass', multiplierToBase: 1, baseUnit: 'g' },
  غم: { canonicalUnit: 'g', dimension: 'mass', multiplierToBase: 1, baseUnit: 'g' },
  جم: { canonicalUnit: 'g', dimension: 'mass', multiplierToBase: 1, baseUnit: 'g' },
  جرام: { canonicalUnit: 'g', dimension: 'mass', multiplierToBase: 1, baseUnit: 'g' },
  غرام: { canonicalUnit: 'g', dimension: 'mass', multiplierToBase: 1, baseUnit: 'g' },

  mg: { canonicalUnit: 'mg', dimension: 'mass', multiplierToBase: 0.001, baseUnit: 'g' },
  mgs: { canonicalUnit: 'mg', dimension: 'mass', multiplierToBase: 0.001, baseUnit: 'g' },
  milligram: { canonicalUnit: 'mg', dimension: 'mass', multiplierToBase: 0.001, baseUnit: 'g' },
  milligrams: { canonicalUnit: 'mg', dimension: 'mass', multiplierToBase: 0.001, baseUnit: 'g' },
  ملجم: { canonicalUnit: 'mg', dimension: 'mass', multiplierToBase: 0.001, baseUnit: 'g' },
  ملغ: { canonicalUnit: 'mg', dimension: 'mass', multiplierToBase: 0.001, baseUnit: 'g' },
  مليغرام: { canonicalUnit: 'mg', dimension: 'mass', multiplierToBase: 0.001, baseUnit: 'g' },

  // Count units (Base: pcs)
  pcs: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  pc: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  p: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  piece: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  pieces: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  count: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  ct: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  item: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  items: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  pack: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  packs: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  pk: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  حبة: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  حبات: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  قطعة: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  قطع: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  بيضة: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  بيض: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  كيس: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  أكياس: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  ظرف: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  أظرف: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  علبة: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  علب: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  طبق: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },
  باكيت: { canonicalUnit: 'pcs', dimension: 'count', multiplierToBase: 1, baseUnit: 'pcs' },

  // Household / Paper Units
  sheet: { canonicalUnit: 'sheet', dimension: 'sheet', multiplierToBase: 1, baseUnit: 'sheet' },
  sheets: { canonicalUnit: 'sheet', dimension: 'sheet', multiplierToBase: 1, baseUnit: 'sheet' },
  منديل: { canonicalUnit: 'sheet', dimension: 'sheet', multiplierToBase: 1, baseUnit: 'sheet' },
  مناديل: { canonicalUnit: 'sheet', dimension: 'sheet', multiplierToBase: 1, baseUnit: 'sheet' },

  roll: { canonicalUnit: 'roll', dimension: 'roll', multiplierToBase: 1, baseUnit: 'roll' },
  rolls: { canonicalUnit: 'roll', dimension: 'roll', multiplierToBase: 1, baseUnit: 'roll' },
  رول: { canonicalUnit: 'roll', dimension: 'roll', multiplierToBase: 1, baseUnit: 'roll' },

  // Length Units (Base: m)
  m: { canonicalUnit: 'm', dimension: 'length', multiplierToBase: 1, baseUnit: 'm' },
  meter: { canonicalUnit: 'm', dimension: 'length', multiplierToBase: 1, baseUnit: 'm' },
  meters: { canonicalUnit: 'm', dimension: 'length', multiplierToBase: 1, baseUnit: 'm' },
  متر: { canonicalUnit: 'm', dimension: 'length', multiplierToBase: 1, baseUnit: 'm' },
  cm: { canonicalUnit: 'cm', dimension: 'length', multiplierToBase: 0.01, baseUnit: 'm' },
  centimeter: { canonicalUnit: 'cm', dimension: 'length', multiplierToBase: 0.01, baseUnit: 'm' },
  سم: { canonicalUnit: 'cm', dimension: 'length', multiplierToBase: 0.01, baseUnit: 'm' },
  سنتيمتر: { canonicalUnit: 'cm', dimension: 'length', multiplierToBase: 0.01, baseUnit: 'm' },
  mm: { canonicalUnit: 'mm', dimension: 'length', multiplierToBase: 0.001, baseUnit: 'm' },
  millimeter: { canonicalUnit: 'mm', dimension: 'length', multiplierToBase: 0.001, baseUnit: 'm' },
  ملمتر: { canonicalUnit: 'mm', dimension: 'length', multiplierToBase: 0.001, baseUnit: 'm' }
}

/**
 * Normalizes a raw unit string into its lookup key.
 */
function cleanUnitKey(rawUnit: string): string {
  if (!rawUnit) return ''
  const normDigits = normalizeArabicNumerals(rawUnit)
  return normDigits
    .toLowerCase()
    .trim()
    .replace(/[.,;:]/g, '')
    .replace(/\s+/g, ' ')
}

/**
 * Normalizes a measurement value and unit into a CanonicalMeasurement representation.
 * Returns null if the value is missing, not a number, or less than or equal to zero.
 */
export function normalizeMeasurement(
  value: number | string | null | undefined,
  unit: string | null | undefined
): CanonicalMeasurement | null {
  if (value == null) return null

  let numericVal: number
  if (typeof value === 'number') {
    numericVal = value
  } else {
    const cleanedStr = normalizeArabicNumerals(String(value).trim())
    numericVal = parseFloat(cleanedStr)
  }

  if (isNaN(numericVal) || numericVal <= 0) {
    return null
  }

  if (!unit || !String(unit).trim()) {
    return null
  }

  const rawUnitStr = String(unit).trim()
  const key = cleanUnitKey(rawUnitStr)
  const spec = UNIT_LOOKUP[key]

  if (spec) {
    // Exact scaled calculation to base unit, rounded to 6 decimal places to eliminate floating point artifacts
    const baseValue = Number((numericVal * spec.multiplierToBase).toFixed(6))
    return {
      rawValue: numericVal,
      rawUnit: rawUnitStr,
      canonicalUnit: spec.canonicalUnit,
      dimension: spec.dimension,
      baseValue,
      baseUnit: spec.baseUnit,
      isRecognized: true
    }
  }

  // Unrecognized unit: preserve raw identity but classify as 'other'
  return {
    rawValue: numericVal,
    rawUnit: rawUnitStr,
    canonicalUnit: key,
    dimension: 'other',
    baseValue: numericVal,
    baseUnit: key,
    isRecognized: false
  }
}

/**
 * Deterministically checks whether two measurements are mathematically equivalent.
 * - Confirms physical dimension compatibility.
 * - Strictly rejects cross-dimensional equivalence (e.g. mass vs volume).
 * - Compares base-scaled values using a strict epsilon (1e-4).
 * - Fails closed on unrecognized, missing, or contradictory units.
 */
export function areMeasurementsEquivalent(
  val1: number | string | null | undefined,
  unit1: string | null | undefined,
  val2: number | string | null | undefined,
  unit2: string | null | undefined
): UnitEquivalenceResult {
  const m1 = normalizeMeasurement(val1, unit1)
  const m2 = normalizeMeasurement(val2, unit2)

  if (!m1 || !m2) {
    const missingParts: string[] = []
    if (!m1) missingParts.push(`offer=${val1 ?? 'null'} ${unit1 ?? 'null'}`)
    if (!m2) missingParts.push(`product=${val2 ?? 'null'} ${unit2 ?? 'null'}`)
    return {
      isEquivalent: false,
      isDimensionCompatible: false,
      reason: `Missing or invalid measurement: ${missingParts.join(', ')}`,
      offerMeasurement: m1,
      productMeasurement: m2
    }
  }

  // Check unit recognition
  if (!m1.isRecognized || !m2.isRecognized) {
    const unrec: string[] = []
    if (!m1.isRecognized) unrec.push(`offer unit '${m1.rawUnit}'`)
    if (!m2.isRecognized) unrec.push(`product unit '${m2.rawUnit}'`)
    return {
      isEquivalent: false,
      isDimensionCompatible: false,
      reason: `Unrecognized or unsupported measurement unit: ${unrec.join(', ')}`,
      offerMeasurement: m1,
      productMeasurement: m2
    }
  }

  // Dimension compatibility check
  if (m1.dimension !== m2.dimension) {
    return {
      isEquivalent: false,
      isDimensionCompatible: false,
      reason: `Incompatible measurement dimensions: offer=${m1.dimension} (${m1.rawValue}${m1.canonicalUnit}) vs product=${m2.dimension} (${m2.rawValue}${m2.canonicalUnit})`,
      offerMeasurement: m1,
      productMeasurement: m2
    }
  }

  // Same dimension: compare base-scaled values
  const delta = Math.abs(m1.baseValue - m2.baseValue)
  const isEquivalent = delta <= EQUIVALENCE_EPSILON

  if (!isEquivalent) {
    return {
      isEquivalent: false,
      isDimensionCompatible: true,
      reason: `Measurement quantity mismatch: offer=${m1.rawValue}${m1.canonicalUnit} (${m1.baseValue}${m1.baseUnit}) vs product=${m2.rawValue}${m2.canonicalUnit} (${m2.baseValue}${m2.baseUnit})`,
      offerMeasurement: m1,
      productMeasurement: m2
    }
  }

  return {
    isEquivalent: true,
    isDimensionCompatible: true,
    reason: `Measurements are mathematically equivalent (${m1.baseValue}${m1.baseUnit})`,
    offerMeasurement: m1,
    productMeasurement: m2
  }
}

/**
 * Returns the physical dimension of a given unit string.
 */
export function getMeasurementDimension(unit: string | null | undefined): MeasurementDimension {
  if (!unit) return 'other'
  const key = cleanUnitKey(unit)
  return UNIT_LOOKUP[key]?.dimension || 'other'
}

/**
 * Converts a measurement value from one unit to another within the same physical dimension.
 * Returns null if dimensions are incompatible or units are unrecognized.
 */
export function convertMeasurement(
  value: number,
  fromUnit: string,
  toUnit: string
): number | null {
  const from = normalizeMeasurement(value, fromUnit)
  if (!from || !from.isRecognized) return null

  const targetKey = cleanUnitKey(toUnit)
  const targetSpec = UNIT_LOOKUP[targetKey]
  if (!targetSpec || targetSpec.dimension !== from.dimension) return null

  const targetValue = from.baseValue / targetSpec.multiplierToBase
  return Number(targetValue.toFixed(6))
}

/**
 * Returns an array of equivalent measurement representations across recognized compatible units.
 * E.g.:
 *  (1, 'l') -> [{ value: 1, unit: 'l', canonicalUnit: 'l' }, { value: 1000, unit: 'ml', canonicalUnit: 'ml' }]
 *  (1000, 'ml') -> [{ value: 1000, unit: 'ml', canonicalUnit: 'ml' }, { value: 1, unit: 'l', canonicalUnit: 'l' }]
 *  (1, 'kg') -> [{ value: 1, unit: 'kg', canonicalUnit: 'kg' }, { value: 1000, unit: 'g', canonicalUnit: 'g' }]
 */
export function getEquivalentMeasurements(
  value: number,
  unit: string
): Array<{ value: number; unit: string; canonicalUnit: string }> {
  const norm = normalizeMeasurement(value, unit)
  if (!norm || !norm.isRecognized) {
    return []
  }

  const results: Array<{ value: number; unit: string; canonicalUnit: string }> = [
    { value: norm.rawValue, unit: norm.rawUnit, canonicalUnit: norm.canonicalUnit }
  ]

  if (norm.dimension === 'volume') {
    if (norm.canonicalUnit === 'l') {
      const mlVal = Number((norm.rawValue * 1000).toFixed(6))
      results.push({ value: mlVal, unit: 'ml', canonicalUnit: 'ml' })
    } else if (norm.canonicalUnit === 'ml') {
      const lVal = Number((norm.rawValue / 1000).toFixed(6))
      results.push({ value: lVal, unit: 'l', canonicalUnit: 'l' })
    } else if (norm.canonicalUnit === 'cl') {
      const mlVal = Number((norm.rawValue * 10).toFixed(6))
      const lVal = Number((norm.rawValue / 100).toFixed(6))
      results.push({ value: mlVal, unit: 'ml', canonicalUnit: 'ml' })
      results.push({ value: lVal, unit: 'l', canonicalUnit: 'l' })
    }
  } else if (norm.dimension === 'mass') {
    if (norm.canonicalUnit === 'kg') {
      const gVal = Number((norm.rawValue * 1000).toFixed(6))
      results.push({ value: gVal, unit: 'g', canonicalUnit: 'g' })
    } else if (norm.canonicalUnit === 'g') {
      const kgVal = Number((norm.rawValue / 1000).toFixed(6))
      results.push({ value: kgVal, unit: 'kg', canonicalUnit: 'kg' })
    } else if (norm.canonicalUnit === 'mg') {
      const gVal = Number((norm.rawValue / 1000).toFixed(6))
      results.push({ value: gVal, unit: 'g', canonicalUnit: 'g' })
    }
  }

  return results
}

/**
 * Detects measurement quantities inside a title string (e.g. "1000ml", "1.5L", "500g", "1kg", "١ لتر")
 * and generates candidate title variants with mathematically equivalent representations.
 * Returns only distinct alternative titles (excluding the input title).
 */
export function generateEquivalentTitleVariants(title: string | null | undefined): string[] {
  if (!title) return []
  const original = title.trim()
  if (!original) return []

  const variants = new Set<string>()

  // Pattern matching volume and mass measurements preceded by start of string, whitespace, or multipack-x
  const measureRegex = /(?<=^|\s|[0-9xX×])(\d+(?:[.,]\d+)?)\s*(l|lt|ltr|liter|litre|liters|litres|لتر|ليتر|ml|mls|milli|milliliter|millilitre|مل|ملي|ملل|kg|kgs|kilo|kilogram|kilograms|كيلو|كجم|كغ|g|gm|gms|grm|gram|grams|غ|غم|جم|جرام)(?=$|\s|[^\w\u0600-\u06FF])/gi

  let match: RegExpExecArray | null
  while ((match = measureRegex.exec(original)) !== null) {
    const fullMatch = match[0]
    const numStr = match[1]
    const unitStr = match[2]

    const normNum = parseFloat(normalizeArabicNumerals(numStr).replace(',', '.'))
    if (isNaN(normNum) || normNum <= 0) continue

    const equivs = getEquivalentMeasurements(normNum, unitStr)
    const normUnitKey = cleanUnitKey(unitStr)
    const currentCanonicalUnit = UNIT_LOOKUP[normUnitKey]?.canonicalUnit

    for (const eq of equivs) {
      if (eq.canonicalUnit === currentCanonicalUnit) continue

      const var1 = original.slice(0, match.index) + `${eq.value}${eq.canonicalUnit}` + original.slice(match.index + fullMatch.length)
      const var2 = original.slice(0, match.index) + `${eq.value} ${eq.canonicalUnit}` + original.slice(match.index + fullMatch.length)

      if (var1.toLowerCase() !== original.toLowerCase()) variants.add(var1)
      if (var2.toLowerCase() !== original.toLowerCase()) variants.add(var2)
    }
  }

  return Array.from(variants)
}

/**
 * For a given canonical product key, generates equivalent key variants by converting
 * the size:unit segment into equivalent representations.
 * E.g.: "alsafi:milk:std:1000ml:1xeach" -> ["alsafi:milk:std:1l:1xeach"]
 */
export function getEquivalentCanonicalKeys(key: string): string[] {
  if (!key) return []
  const parts = key.split(':')
  if (parts.length < 5) return []

  const sizeSegment = parts[3]
  const match = sizeSegment.match(/^(\d+(?:\.\d+)?)([a-z]+)$/i)
  if (!match) return []

  const val = parseFloat(match[1])
  const unit = match[2]
  if (isNaN(val) || val <= 0) return []

  const equivs = getEquivalentMeasurements(val, unit)
  const normUnit = cleanUnitKey(unit)
  const currentCanonical = UNIT_LOOKUP[normUnit]?.canonicalUnit

  const results: string[] = []
  for (const eq of equivs) {
    if (eq.canonicalUnit === currentCanonical && eq.value === val) continue

    const altParts = [...parts]
    altParts[3] = `${eq.value}${eq.canonicalUnit}`
    const altKey = altParts.join(':')
    if (altKey !== key && !results.includes(altKey)) {
      results.push(altKey)
    }
  }

  return results
}


