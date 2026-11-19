import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  loadStagedLeafletDraft,
  buildStagedItemsFromEligible
} from '../../db/stagedLeafletDraftService'
import { getDbEligibleItemsFromPackage } from '../../extraction/extractionPackageService'
import { buildPrePublishSummary } from '../../prepublish/prePublishApprovalService'
import { toRenderableImageSrc } from '../../../shared/utils/renderableImageUtils'
import type { CanonicalOffer } from '../../../shared/types/canonicalOffer'

describe('WIFRAN-EXTRACTOR-ONE-CLICK-PREVIEW-001: One-Click Leaflet Extraction With Automatic Local Product Thumbnails', () => {
  const nooriWorkspace = join(process.cwd(), 'Extracts', 'noori-supermarket-229798534-jeddah')

  // --------------------------------------------------------------------------
  // Test A: Fazco Fine Sugar (Offer 005)
  // --------------------------------------------------------------------------
  it('Test A: Fazco Fine Sugar (Offer 005) resolves product thumbnail crop, pricing, and full evidence', async () => {
    const canonical005Path = join(nooriWorkspace, 'json', 'page-001-005.canonical.json')
    expect(existsSync(canonical005Path)).toBe(true)

    const raw = readFileSync(canonical005Path, 'utf-8')
    const canonical005: CanonicalOffer = JSON.parse(raw)

    expect(canonical005.product?.title_en).toBe('Fazco Fine Sugar 5kg')
    expect(canonical005.product?.title_ar).toBe('سكر فاصكو ناعم 5 كيلو')
    expect(canonical005.prices?.offer_price).toBe(16.5)
    expect(canonical005.prices?.original_price).toBe(25.0)
    expect(canonical005.content?.size_text).toBe('5 كيلو')

    // Verify dual crops exist on disk
    expect(existsSync(canonical005.source.crop_path as string)).toBe(true)
    expect(canonical005.source.thumbnail_path).toBeDefined()
    expect(existsSync(canonical005.source.thumbnail_path as string)).toBe(true)
    expect(canonical005.source.crop_path).toContain('offer_card_crop.webp')
    expect(canonical005.source.thumbnail_path).toContain('product_thumb_crop.webp')

    // Verify package extraction resolves both cropPath and thumbnailPath
    const eligible = await getDbEligibleItemsFromPackage(nooriWorkspace)
    const item005 = eligible.find((item) => item.itemNumber === '005')
    expect(item005).toBeDefined()
    expect(item005!.cropPath).toContain('offer_card_crop.webp')
    expect(item005!.thumbnailPath).toContain('product_thumb_crop.webp')

    // Verify pre-publish summary includes thumbnail_path and preserves crop_path
    const summary = await buildPrePublishSummary(nooriWorkspace, [canonical005])
    const summary005 = summary.items.find((i) => i.source_item_number === '005')
    expect(summary005).toBeDefined()
    expect(summary005!.crop_path).toContain('offer_card_crop.webp')
    expect(summary005!.thumbnail_path).toContain('product_thumb_crop.webp')

    // Fresh one-click staging defaults to product_thumb image source
    const freshStagedItems = buildStagedItemsFromEligible([item005!])
    expect(freshStagedItems.length).toBe(1)
    expect(freshStagedItems[0].croppedEvidenceLocalPath).toContain('offer_card_crop.webp')
    expect(freshStagedItems[0].productThumbLocalPath).toContain('product_thumb_crop.webp')
    expect(freshStagedItems[0].selectedImageSource).toBe('product_thumb')
  })

  // --------------------------------------------------------------------------
  // Test B: Qoot & Root Flour (Offer 007)
  // --------------------------------------------------------------------------
  it('Test B: Qoot & Root Flour (Offer 007) preserves 9-pack quantity semantics alongside product thumbnail', async () => {
    const canonical007Path = join(nooriWorkspace, 'json', 'page-001-007.canonical.json')
    const raw = readFileSync(canonical007Path, 'utf-8')
    const canonical007: CanonicalOffer = JSON.parse(raw)

    const summary = await buildPrePublishSummary(nooriWorkspace, [canonical007])
    const summary007 = summary.items.find((i) => i.source_item_number === '007')
    expect(summary007).toBeDefined()
    expect(summary007!.thumbnail_path).toContain('product_thumb_crop.webp')

    const fields = summary007!.fields
    const getField = (name: string) => fields.find((f) => f.field_name === name)?.value

    // Quantity semantics must be completely preserved
    expect(getField('pack_quantity')).toBe(9)
    expect(getField('each_size_value')).toBe(1)
    expect(getField('each_size_unit')).toBe('kilogram')
    expect(getField('total_content_value')).toBe(9)
    expect(getField('total_content_unit')).toBe('kilogram')
    expect(getField('special_offer')).toBe('9 حبات')

    const eligible = await getDbEligibleItemsFromPackage(nooriWorkspace)
    const item007 = eligible.find((i) => i.itemNumber === '007')
    expect(item007).toBeDefined()

    const stagedItems = buildStagedItemsFromEligible([item007!])
    const staged007 = stagedItems[0]
    expect(staged007).toBeDefined()
    expect(staged007.sizeOrWeight).toBe('9 × 1 كيلو')
    expect(staged007.inner_pack_count).toBe(9)
    expect(staged007.productThumbLocalPath).toContain('product_thumb_crop.webp')
    expect(staged007.selectedImageSource).toBe('product_thumb')
  })

  // --------------------------------------------------------------------------
  // Test C: Fakieh Chicken (Offers 002 & 003)
  // --------------------------------------------------------------------------
  it('Test C: Fakieh Chicken preserves compound units, carton and single bag with associated thumbnail crops', async () => {
    const raw002 = readFileSync(join(nooriWorkspace, 'json', 'page-001-002.canonical.json'), 'utf-8')
    const raw003 = readFileSync(join(nooriWorkspace, 'json', 'page-001-003.canonical.json'), 'utf-8')
    const canonical002: CanonicalOffer = JSON.parse(raw002)
    const canonical003: CanonicalOffer = JSON.parse(raw003)

    // Offer 002: 10-pack carton at SAR 141
    expect(canonical002.prices?.offer_price).toBe(141)
    expect(canonical002.prices?.original_price).toBe(202)
    expect(canonical002.content?.pack_quantity).toBe(10)
    // Offer 003: Single bag at SAR 15.5
    expect(canonical003.prices?.offer_price).toBe(15.5)
    expect(canonical003.content?.pack_quantity).toBe(1)

    // Both share the same visual crop boundary on the leaflet
    expect(canonical002.source.crop_path).toContain('offer-002')
    expect(canonical003.source.crop_path).toContain('offer-002')

    const eligible = await getDbEligibleItemsFromPackage(nooriWorkspace)
    const eligible002 = eligible.find((i) => i.itemNumber === '002')
    const eligible003 = eligible.find((i) => i.itemNumber === '003')

    expect(eligible002).toBeDefined()
    expect(eligible003).toBeDefined()
    expect(eligible002!.thumbnailPath).toBeDefined()
    expect(eligible003!.thumbnailPath).toBeDefined()
    expect(existsSync(eligible002!.thumbnailPath!)).toBe(true)
    expect(existsSync(eligible003!.thumbnailPath!)).toBe(true)
  })

  // --------------------------------------------------------------------------
  // Test D: Softy Tissues (Offer 009)
  // --------------------------------------------------------------------------
  it('Test D: Softy Tissues (Offer 009) preserves 7+3 Free promotional unit with resolved thumbnail', async () => {
    const raw009 = readFileSync(join(nooriWorkspace, 'json', 'page-001-009.canonical.json'), 'utf-8')
    const canonical009: CanonicalOffer = JSON.parse(raw009)

    expect(canonical009.prices?.offer_price).toBe(13.99)
    expect(canonical009.prices?.original_price).toBe(23.95)
    expect(canonical009.content?.pack_quantity).toBe(10)

    const summary = await buildPrePublishSummary(nooriWorkspace, [canonical009])
    const item009 = summary.items.find((i) => i.source_item_number === '009')
    expect(item009).toBeDefined()
    expect(item009!.thumbnail_path).toContain('product_thumb_crop.webp')
    expect(existsSync(item009!.thumbnail_path!)).toBe(true)
  })

  // --------------------------------------------------------------------------
  // Test E: Noori Full-Page Preview (All 10 Offers)
  // --------------------------------------------------------------------------
  it('Test E: Full-page extraction yields complete 10-offer preview with local thumbnails and zero CSV input', async () => {
    const eligible = await getDbEligibleItemsFromPackage(nooriWorkspace)
    expect(eligible.length).toBe(10)

    // Every single offer must have a valid thumbnailPath pointing to an existing file
    for (const item of eligible) {
      expect(item.thumbnailPath).toBeDefined()
      expect(existsSync(item.thumbnailPath!)).toBe(true)
      expect(item.cropPath).toBeDefined()
      expect(existsSync(item.cropPath)).toBe(true)
    }

    // Pre-publish summary must build with all 10 offers
    const allCanonicals: CanonicalOffer[] = eligible.map((item) => item.jsonData as unknown as CanonicalOffer)
    const summary = await buildPrePublishSummary(nooriWorkspace, allCanonicals)
    expect(summary.items.length).toBe(10)

    for (const item of summary.items) {
      expect(item.thumbnail_path).toBeDefined()
      expect(existsSync(item.thumbnail_path!)).toBe(true)
      expect(item.crop_path).toBeDefined()
      expect(existsSync(item.crop_path)).toBe(true)
    }

    // Fresh one-click staging initializes all 10 offers with selectedImageSource = 'product_thumb'
    const freshDraftItems = buildStagedItemsFromEligible(eligible)
    expect(freshDraftItems.length).toBe(10)
    for (const stagedItem of freshDraftItems) {
      expect(stagedItem.productThumbLocalPath).toBeDefined()
      expect(existsSync(stagedItem.productThumbLocalPath!)).toBe(true)
      expect(stagedItem.selectedImageSource).toBe('product_thumb')
    }
  })

  // --------------------------------------------------------------------------
  // Test F: Public Data Isolation (Security & Architecture Boundary)
  // --------------------------------------------------------------------------
  it('Test F: Public data isolation guarantees private leaflet crops never leak into public display image payloads', async () => {
    const eligible = await getDbEligibleItemsFromPackage(nooriWorkspace)
    const freshDraftItems = buildStagedItemsFromEligible(eligible)

    for (const item of freshDraftItems) {
      // In product_thumb mode, the image is an internal preview asset only
      expect(item.selectedImageSource).toBe('product_thumb')

      // Ensure that when selectedImageSource === 'product_thumb', no external public candidate image URL exists
      // and it is distinct from verified public database images
      expect(item.existingDbImageUrl || null).toBeNull()
      expect(item.candidateImageUrl || null).toBeNull()

      // The local paths are absolute local filesystem paths, not public web URLs
      expect(item.productThumbLocalPath).not.toMatch(/^https?:\/\//)
      expect(item.croppedEvidenceLocalPath).not.toMatch(/^https?:\/\//)
    }
  })

  // --------------------------------------------------------------------------
  // Test G: Application Restart / Workspace Reopening
  // --------------------------------------------------------------------------
  it('Test G: Application restart / workspace reload preserves thumbnail resolution across disk writes', async () => {
    // 1. Load draft from disk (simulating application restart or reopening past workspace)
    const reloadedDraft = await loadStagedLeafletDraft(nooriWorkspace)
    expect(reloadedDraft).toBeDefined()
    expect(reloadedDraft!.items.length).toBe(10)

    for (const item of reloadedDraft!.items) {
      expect(item.productThumbLocalPath).toBeDefined()
      expect(existsSync(item.productThumbLocalPath!)).toBe(true)

      // Verify Electron privileged local-file protocol conversion
      const renderSrc = toRenderableImageSrc(item.productThumbLocalPath)
      expect(renderSrc).toBeDefined()
      expect(renderSrc).toMatch(/^local-file:\/\/get\?path=/)
    }
  })

  // --------------------------------------------------------------------------
  // Test H: Missing Thumbnail Fallback
  // --------------------------------------------------------------------------
  it('Test H: Absent thumbnail gracefully produces fallback without crashing, keeping evidence crop accessible', async () => {
    const raw = readFileSync(join(nooriWorkspace, 'json', 'page-001-005.canonical.json'), 'utf-8')
    const simulatedOffer: CanonicalOffer = JSON.parse(raw)

    // Intentionally simulate missing thumbnail in canonical offer and no sibling on disk
    simulatedOffer.source.thumbnail_path = undefined
    if (simulatedOffer.image) {
      simulatedOffer.image.thumbnail_path = undefined
    }
    // Point crop_path to a location without a product_thumb_crop.webp sibling
    simulatedOffer.source.crop_path = join(nooriWorkspace, 'non-existent-crop-file.webp')

    // Build pre-publish summary with simulated missing thumbnail
    const summary = await buildPrePublishSummary(nooriWorkspace, [simulatedOffer])
    expect(summary.items.length).toBe(1)

    const item = summary.items[0]
    // Sibling discovery on non-existent sibling returns null
    expect(item.thumbnail_path).toBeNull()

    // But full evidence crop path remains accessible for operator inspection
    expect(item.crop_path).toBe(simulatedOffer.source.crop_path)
  })
})
