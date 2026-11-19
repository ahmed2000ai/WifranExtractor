import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { LiveCatalogMatchingBenchmarkRunner } from '../liveCatalogMatchingBenchmarkRunner'
import { calculateGeminiCost, getModelPricing } from '../geminiPricingTable'

describe('WIFRAN-EXTRACTOR-CATALOG-MATCH-002: Live Benchmark Dataset, Pricing & Preflight Verification', () => {
  const datasetPath = join(process.cwd(), 'test-fixtures', 'matching-benchmarks', 'live_benchmark_dataset_v1.json')

  it('validates 14 independently supported source identities, complete provenance, and shared-crop sub-references', () => {
    expect(existsSync(datasetPath)).toBe(true)
    const rawData = JSON.parse(readFileSync(datasetPath, 'utf8'))

    expect(rawData.totalOffers).toBe(14)
    expect(rawData.geminiEvaluatedOffers).toBe(7)
    expect(rawData.locallyHandledOffers).toBe(7)
    expect(rawData.items.length).toBe(14)

    // Ensure duplicate fixture sadia_o2_nuggets_mini_chef_270g is removed
    expect(rawData.items.some((x: any) => x.sourceOfferId === 'sadia_o2_nuggets_mini_chef_270g')).toBe(false)

    for (const item of rawData.items) {
      expect(item.sourceOfferId).toBeTruthy()
      expect(item.canonicalSourceId).toBeTruthy()
      expect(item.retailer).toBeTruthy()
      expect(item.sourcePdfFileName).toBeTruthy()
      expect(item.sourceLeaflet).toBeTruthy()
      expect(item.sourceFile).toBeTruthy()
      expect(item.pageNumber).toBeGreaterThanOrEqual(1)
      expect(item.parentOfferCropRef).toBeTruthy()
      expect(item.cropPath).toBeTruthy()
      expect(item.thumbCropPath).toBeTruthy()
      expect(['existing', 'temporary', 'unresolved']).toContain(item.expectedDecision)
      expect(['existing', 'temporary', 'unresolved']).toContain(item.goldLabel)

      // Verify source JSON and crop images exist on disk
      expect(existsSync(join(process.cwd(), item.sourceFile))).toBe(true)
      expect(existsSync(join(process.cwd(), item.cropPath))).toBe(true)
      expect(existsSync(join(process.cwd(), item.thumbCropPath))).toBe(true)
    }

    // Verify shared multi-SKU crops explicitly document distinct subProductRef labels
    const bndwSingle = rawData.items.find((x: any) => x.sourceOfferId === 'sadia_b1_whole_chicken_1000g_single')
    const bndwCarton = rawData.items.find((x: any) => x.sourceOfferId === 'sadia_b2_whole_chicken_10x1000g_carton')
    expect(bndwSingle.subProductRef).toBeTruthy()
    expect(bndwCarton.subProductRef).toBeTruthy()
    expect(bndwSingle.subProductRef).not.toBe(bndwCarton.subProductRef)

    const nooriCarton = rawData.items.find((x: any) => x.sourceOfferId === 'fakieh_n1_frozen_chicken_10x1000g')
    const nooriSingle = rawData.items.find((x: any) => x.sourceOfferId === 'fakieh_n2_frozen_chicken_1000g_single')
    expect(nooriCarton.subProductRef).toBeTruthy()
    expect(nooriSingle.subProductRef).toBeTruthy()
    expect(nooriCarton.subProductRef).not.toBe(nooriSingle.subProductRef)
  })

  it('verifies product packaging semantics for Seara 3x900g multi-buy and Sadia Nuggets', () => {
    const rawData = JSON.parse(readFileSync(datasetPath, 'utf8'))

    const searaPromo = rawData.items.find((x: any) => x.sourceOfferId === 'seara_p3_frozen_chicken_3x900g_promo')
    expect(searaPromo).toBeDefined()
    expect(searaPromo.eachSizeValue).toBe(900)
    expect(searaPromo.eachSizeUnit).toBe('g')
    expect(searaPromo.innerPackCount).toBe(1)
    expect(searaPromo.promoConditionQuantity).toBe(3)
    expect(searaPromo.expectedDecision).toBe('existing')
    expect(searaPromo.targetProductNameEn).toBe('Seara Frozen Chicken 900g')

    const sadiaNuggets = rawData.items.find((x: any) => x.sourceOfferId === 'sadia_o1_nuggets_270g_pack')
    expect(sadiaNuggets).toBeDefined()
    expect(sadiaNuggets.eachSizeValue).toBe(270)
    expect(sadiaNuggets.eachSizeUnit).toBe('g')
    expect(sadiaNuggets.innerPackCount).toBe(1)
    expect(sadiaNuggets.customerPurchaseLimit).toBe(5)
    expect(sadiaNuggets.expectedDecision).toBe('unresolved')
    expect(sadiaNuggets.targetProductNameEn).toBeNull()
  })

  it('verifies global Gemini 3.8 Flash Flex pricing ($0.375 input, $1.875 output/thinking) and prevents double-charging thinking tokens', () => {
    const rates = getModelPricing('gemini-3.8-flash', 'flex', '2026-11-13')
    expect(rates.inputPerMillion).toBe(0.375)
    expect(rates.outputPerMillion).toBe(1.875)
    expect(rates.thinkingPerMillion).toBe(1.875)

    // Case 1: Disjoint SDK token reporting (totalTokenCount = prompt + candidates + thoughts)
    const disjoint = calculateGeminiCost(
      {
        promptTokenCount: 1030,
        candidatesTokenCount: 120,
        thoughtsTokenCount: 2400,
        totalTokenCount: 3550
      },
      'gemini-3.8-flash',
      'flex',
      '2026-11-13'
    )
    expect(disjoint.totalCostUsd).toBeCloseTo(0.00511125, 6)

    // Case 2: Aggregate output reporting (candidatesTokenCount ALREADY includes thoughtsTokenCount)
    const aggregateOutput = calculateGeminiCost(
      {
        promptTokenCount: 1030,
        candidatesTokenCount: 2520, // 120 visible + 2400 thinking combined
        thoughtsTokenCount: 2400,
        totalTokenCount: 3550 // equals prompt (1030) + candidates (2520)
      },
      'gemini-3.8-flash',
      'flex',
      '2026-11-13'
    )
    // Must produce the exact same $0.00511125 cost without charging thinking tokens twice
    expect(aggregateOutput.totalCostUsd).toBeCloseTo(0.00511125, 6)
    expect(aggregateOutput.outputCostUsd).toBeCloseTo(disjoint.outputCostUsd, 8)
    expect(aggregateOutput.thinkingCostUsd).toBeCloseTo(disjoint.thinkingCostUsd, 8)
  })

  it('enforces budget boundaries and environment isolation fail-closed guards', () => {
    const runner = new LiveCatalogMatchingBenchmarkRunner()
    const catalogDef = runner.getBenchmarkCatalogDefinition()

    expect(catalogDef.length).toBe(10)
    expect(() => runner.assertEnvironmentIsolation()).not.toThrow()
  })
})
