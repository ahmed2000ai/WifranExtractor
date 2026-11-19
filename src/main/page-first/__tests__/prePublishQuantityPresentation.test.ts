import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { initializeStagedDraftFromPackage } from '../../db/stagedLeafletDraftService'
import { buildPrePublishSummary } from '../../prepublish/prePublishApprovalService'
import type { CanonicalOffer } from '../../../shared/types/canonicalOffer'

describe('WIFRAN-EXTRACTOR-FINAL-INTEGRATION-001: Pre-Publish Quantity Presentation', () => {
  const nooriWorkspace = join(process.cwd(), 'Extracts', 'noori-supermarket-229798534-jeddah')
  const canonical007Path = join(nooriWorkspace, 'json', 'page-001-007.canonical.json')

  it('verifies Noori Offer 007 canonical baseline integrity', () => {
    expect(existsSync(canonical007Path)).toBe(true)
    const raw = readFileSync(canonical007Path, 'utf-8')
    const canonical: CanonicalOffer = JSON.parse(raw)

    expect(canonical.product?.title_en).toBe('Qoot & Root Premium Flour 1kg')
    expect(canonical.product?.title_ar).toBe('دقيق قوت آند روت فاخر 1 كيلو')
    expect(canonical.prices?.offer_price).toBe(9.99)
    expect(canonical.prices?.original_price).toBe(26.55)

    // Verify quantity content block
    expect(canonical.content?.pack_quantity).toBe(9)
    expect(canonical.content?.each_size_value).toBe(1)
    expect(canonical.content?.each_size_unit).toBe('kilogram')
    expect(canonical.content?.total_content_value).toBe(9)
    expect(canonical.content?.total_content_unit).toBe('kilogram')
    expect(canonical.content?.size_text).toBe('1 كيلو')

    // Verify contract_v2 quantity semantics
    expect(canonical.contract_v2?.quantity_semantics?.inner_count).toBe(9)
    expect(canonical.contract_v2?.quantity_semantics?.per_inner_content?.value).toBe(1)
    expect(canonical.contract_v2?.quantity_semantics?.per_inner_content?.unit).toBe('kilogram')
    expect(canonical.contract_v2?.quantity_semantics?.total_content?.value).toBe(9)
    expect(canonical.contract_v2?.quantity_semantics?.total_content?.unit).toBe('kilogram')
  })

  it('corrects staged draft item mapping to display 9 bags and structured breakdown for Offer 007', async () => {
    // Generate staged draft from the real Noori package
    const draft = await initializeStagedDraftFromPackage(nooriWorkspace)
    expect(draft).toBeDefined()
    expect(draft.items.length).toBeGreaterThan(0)

    const offer007 = draft.items.find(
      (item) => item.id.includes('007') || item.sourceOfferId?.includes('007')
    )
    expect(offer007).toBeDefined()

    // sizeOrWeight must not omit the 9-pack count!
    expect(offer007!.sizeOrWeight).toBe('9 × 1 كيلو')
    expect(offer007!.originalOcr.sizeOrWeight).toBe('9 × 1 كيلو')

    // Decomposed quantity dimensions must be distinguished
    expect(offer007!.inner_pack_count).toBe(9)
    expect(offer007!.each_size_value).toBe(1)
    expect(offer007!.each_size_unit).toBe('kilogram')
    expect(offer007!.total_content_value).toBe(9)
    expect(offer007!.total_content_unit).toBe('kilogram')
    expect(offer007!.originalOcr.inner_pack_count).toBe(9)
    expect(offer007!.originalOcr.total_content_value).toBe(9)
  })

  it('corrects pre-publish summary fields to distinguish all quantity dimensions', async () => {
    const raw = readFileSync(canonical007Path, 'utf-8')
    const canonical007: CanonicalOffer = JSON.parse(raw)

    const summary = await buildPrePublishSummary(nooriWorkspace, [canonical007])
    expect(summary.items.length).toBeGreaterThanOrEqual(1)

    const summaryItem007 = summary.items.find(
      (it) => it.source_item_number === '007' || it.source_item_number === 7 as any
    )
    expect(summaryItem007).toBeDefined()

    const fields = summaryItem007!.fields
    const getField = (name: string) => fields.find((f) => f.field_name === name)?.value

    // Verify 5 distinct quantity dimensions in pre-publish summary fields
    expect(getField('pack_quantity')).toBe(9)
    expect(getField('each_size_value')).toBe(1)
    expect(getField('each_size_unit')).toBe('kilogram')
    expect(getField('total_content_value')).toBe(9)
    expect(getField('total_content_unit')).toBe('kilogram')
    expect(getField('size_text')).toBe('1 كيلو')
    expect(getField('special_offer')).toBe('9 حبات')
  })

  it('handles cartons, trays, bonus free units and customer purchase limits consistently', async () => {
    // 1. Chicken Carton (10 x 900g)
    const chickenCarton: CanonicalOffer = {
      source: { leaflet_id: 'test', source_page_number: 1, source_item_number: '002' } as any,
      trusted_context: {} as any,
      product: { title_en: 'Frozen Chicken 10x900g', title_ar: 'دجاج مجمد 10 × 900 غرام' } as any,
      prices: { offer_price: 139.95, original_price: 180.0, currency: 'SAR' } as any,
      content: {
        size_text: '900 غرام',
        pack_quantity: 10,
        each_size_value: 900,
        each_size_unit: 'gram',
        total_content_value: 9000,
        total_content_unit: 'gram'
      } as any,
      promotion: { mechanic: 'standard_price', special_offer: null, quantity_limit: '2 كرتون لكل عميل' } as any,
      comparison: { comparison_eligible: true, comparison_unit: 'kilogram', comparison_unit_price: 15.55 } as any,
      quality: { publish_decision: 'publish' } as any
    } as any

    // 2. Bonus Pack (Tissues 7+3 Free)
    const tissueBonus: CanonicalOffer = {
      source: { leaflet_id: 'test', source_page_number: 1, source_item_number: '009' } as any,
      trusted_context: {} as any,
      product: { title_en: 'Facial Tissues (7+3 Free)', title_ar: 'مناديل وجه (7+3 مجانا)' } as any,
      prices: { offer_price: 24.95, original_price: 36.0, currency: 'SAR' } as any,
      content: {
        size_text: '10 علب',
        pack_quantity: 10,
        each_size_value: 200,
        each_size_unit: 'sheets',
        total_content_value: 2000,
        total_content_unit: 'sheets'
      } as any,
      promotion: { mechanic: 'bonus_free', special_offer: '7+3 مجانا', quantity_limit: null } as any,
      comparison: { comparison_eligible: true } as any,
      quality: { publish_decision: 'publish' } as any
    } as any

    const summary = await buildPrePublishSummary(nooriWorkspace, [chickenCarton, tissueBonus])

    const chickenSummary = summary.items.find((it) => it.source_item_number === '002')
    expect(chickenSummary).toBeDefined()
    const getChickenField = (name: string) => chickenSummary!.fields.find((f) => f.field_name === name)?.value
    expect(getChickenField('pack_quantity')).toBe(10)
    expect(getChickenField('each_size_value')).toBe(900)
    expect(getChickenField('total_content_value')).toBe(9000)
    expect(getChickenField('quantity_limit')).toBe('2 كرتون لكل عميل')

    const tissueSummary = summary.items.find((it) => it.source_item_number === '009')
    expect(tissueSummary).toBeDefined()
    const getTissueField = (name: string) => tissueSummary!.fields.find((f) => f.field_name === name)?.value
    expect(getTissueField('pack_quantity')).toBe(10)
    expect(getTissueField('special_offer')).toBe('7+3 مجانا')
  })
})

