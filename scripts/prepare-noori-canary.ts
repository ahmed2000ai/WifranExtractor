import * as fs from 'fs'
import * as path from 'path'
import sharp from 'sharp'
import {
  saveStagedLeafletDraft,
  loadStagedLeafletDraft,
  exportStagedLeafletForStep2,
  preMatchLocalOffersAgainstDb
} from '../src/main/db/stagedLeafletDraftService'
import { buildPrePublishSummary } from '../src/main/prepublish/prePublishApprovalService'
import { validateProductIdentityCompatibility } from '../src/main/db/productIdentityCompatibilityValidator'
import { getSupabaseAdminClient } from '../src/main/db/supabaseAdminClient'

async function prepareNooriCanary() {
  console.log('======================================================================')
  console.log('WIFRAN-EXTRACTOR-IDENTITY-001M — CANARY BATCH PREPARATION')
  console.log('======================================================================\n')

  const outDir = path.resolve(process.cwd(), 'tmp/noori_canary_preparation')
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(path.join(outDir, 'json'), { recursive: true })
  fs.mkdirSync(path.join(outDir, 'pages'), { recursive: true })
  fs.mkdirSync(path.join(outDir, 'crops'), { recursive: true })
  fs.mkdirSync(path.join(outDir, 'metadata/reports'), { recursive: true })

  // 1. Copy rendered page 1
  const renderedPage1 = path.resolve(process.cwd(), 'tmp/noori_test/page_1.1.png')
  fs.copyFileSync(renderedPage1, path.join(outDir, 'pages/page.1.png'))
  console.log('[Setup] Page 1 image copied.')

  // 2. Generate crops for the 3 canary offers using Sharp
  // Image is 1200 x 1600
  // Offer 1: Al Safi Milk (Top Left) -> left: 20, top: 530, width: 570, height: 470
  // Offer 2: Fakieh Chicken (Bottom Left) -> left: 20, top: 1010, width: 570, height: 470
  // Offer 3: Al Shalan Rice (Bottom Right) -> left: 610, top: 1010, width: 570, height: 470
  const cropsInfo = [
    { idx: 1, name: 'offer-001', rect: { left: 20, top: 530, width: 570, height: 470 } },
    { idx: 2, name: 'offer-002', rect: { left: 20, top: 1010, width: 570, height: 470 } },
    { idx: 3, name: 'offer-003', rect: { left: 610, top: 1010, width: 570, height: 470 } }
  ]

  for (const c of cropsInfo) {
    const cropFolder = path.join(outDir, `crops/${c.name}`)
    fs.mkdirSync(cropFolder, { recursive: true })
    const cropPath = path.join(cropFolder, 'offer_card_crop.webp')
    await sharp(renderedPage1)
      .extract(c.rect)
      .webp({ quality: 85 })
      .toFile(cropPath)
    
    // Also thumb crop
    const thumbPath = path.join(cropFolder, 'product_thumb_crop.webp')
    await sharp(cropPath)
      .resize(300, 300, { fit: 'inside' })
      .webp({ quality: 80 })
      .toFile(thumbPath)
  }
  console.log('[Setup] 3 offer card crops and thumbs generated.')

  // 3. Create Canonical JSON Files for the 3 Offers
  const canonicalOffers = [
    {
      offer: {
        title_en: 'Al Safi Long Life Full Cream Milk 12x1Lt',
        title_ar: 'حليب الصافي طويل الأجل كامل الدسم 3 × 4 لتر',
        brand: 'Al Safi',
        size_or_weight: '12x1Lt',
        price_before: 72.00,
        offer_price: 32.99,
        price_after: 32.99,
        discount_percentage: 54.18
      },
      product: {
        title_en: 'Al Safi Long Life Full Cream Milk 12x1Lt',
        title_ar: 'حليب الصافي طويل الأجل كامل الدسم 3 × 4 لتر',
        brand_text: 'Al Safi'
      },
      prices: {
        original_price: 72.00,
        offer_price: 32.99,
        discount_percentage: 54.18
      },
      content: {
        size_text: '12x1Lt',
        each_size_value: 1,
        each_size_unit: 'l',
        inner_pack_count: 12,
        sale_unit_type: 'pack'
      },
      promotion: {
        quantity_limit: '1 كرتون',
        quantity_limit_value: 1
      },
      source: {
        page_number: 1,
        offer_index: 1,
        source_offer_id: 'noori-city-jeddah-2026-11-11:p001:i001:s01'
      },
      quality: {
        publish_decision: 'publish'
      }
    },
    {
      offer: {
        title_en: 'Fakieh Frozen Chicken 10x600g',
        title_ar: 'دجاج فقيه مجمد 10 × 600 جرام',
        brand: 'Fakieh',
        size_or_weight: '10x600g',
        price_before: 124.95,
        offer_price: 62.99,
        price_after: 62.99,
        discount_percentage: 49.59
      },
      product: {
        title_en: 'Fakieh Frozen Chicken 10x600g',
        title_ar: 'دجاج فقيه مجمد 10 × 600 جرام',
        brand_text: 'Fakieh'
      },
      prices: {
        original_price: 124.95,
        offer_price: 62.99,
        discount_percentage: 49.59
      },
      content: {
        size_text: '10x600g',
        each_size_value: 600,
        each_size_unit: 'g',
        inner_pack_count: 10,
        sale_unit_type: 'pack'
      },
      promotion: {
        quantity_limit: '1 كرتون',
        quantity_limit_value: 1
      },
      source: {
        page_number: 1,
        offer_index: 2,
        source_offer_id: 'noori-city-jeddah-2026-11-11:p001:i002:s01'
      },
      quality: {
        publish_decision: 'publish'
      }
    },
    {
      offer: {
        title_en: 'Al Shalan Sella Basmati Rice 5kg',
        title_ar: 'أرز الشعلان مزة هندي بسمتي 5 كيلو',
        brand: 'Al Shalan',
        size_or_weight: '5kg',
        price_before: 49.50,
        offer_price: 19.99,
        price_after: 19.99,
        discount_percentage: 59.62
      },
      product: {
        title_en: 'Al Shalan Sella Basmati Rice 5kg',
        title_ar: 'أرز الشعلان مزة هندي بسمتي 5 كيلو',
        brand_text: 'Al Shalan'
      },
      prices: {
        original_price: 49.50,
        offer_price: 19.99,
        discount_percentage: 59.62
      },
      content: {
        size_text: '5kg',
        each_size_value: 5,
        each_size_unit: 'kg',
        inner_pack_count: 1,
        sale_unit_type: 'bag'
      },
      promotion: {
        quantity_limit: '1 كيس',
        quantity_limit_value: 1
      },
      source: {
        page_number: 1,
        offer_index: 3,
        source_offer_id: 'noori-city-jeddah-2026-11-11:p001:i003:s01'
      },
      quality: {
        publish_decision: 'publish'
      }
    }
  ]

  for (let i = 0; i < canonicalOffers.length; i++) {
    const fName = `page-001-${String(i + 1).padStart(3, '0')}.canonical.json`
    fs.writeFileSync(path.join(outDir, 'json', fName), JSON.stringify(canonicalOffers[i], null, 2), 'utf8')
  }
  console.log('[Setup] 3 Canonical JSON files created.')

  // 4. Create Manifest
  const manifest = {
    schema_version: 1,
    extraction_status: 'in_progress',
    db_update_status: 'not_started',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    extraction_folder_name: 'noori_canary_preparation',
    pdf_file_name: 'noori-supermarket-229796668-jeddah.pdf',
    pdf_base_name: 'noori-supermarket-229796668-jeddah',
    page_count: 1,
    processing_scope: {
      mode: 'selected_pages',
      pages: [1]
    },
    supermarket: {
      name_en: 'Noori Supermarket',
      name_ar: 'أسواق نوري',
      slug: 'noori'
    },
    location: {
      location_scope: 'city',
      city_id: 'a6f7b140-0002-4444-a000-000000000002', // Jeddah
      region_id: 'b144b6c8-2222-4444-b000-000000000002', // Western
      display_name: 'Jeddah',
      location_slug: 'jeddah'
    },
    offer_dates: {
      valid_from: '2026-11-02',
      valid_to: '2026-11-11'
    },
    leaflet_filename_metadata: {
      source_file_name: 'noori-supermarket-229796668-jeddah.pdf',
      parsed_ok: true,
      supermarket_description: 'Noori Supermarket',
      location_description: 'Jeddah'
    },
    stages: {
      pdf_copy: 'completed',
      page_rendering: 'completed',
      crop_generation: 'completed',
      item_ocr: 'completed',
      db_update: 'not_started'
    },
    counts: {
      pages_rendered: 1,
      chunks: 0,
      crop_images: 3,
      json_files: 3,
      matched_crop_json_pairs: 3,
      orphan_crop_images: 0,
      orphan_json_files: 0,
      keys_with_values: 0,
      keys_without_values: 0
    },
    paths: {
      pdf: 'Leaflets/noori-supermarket-229796668-jeddah.pdf',
      pages_dir: 'pages',
      crops_dir: 'crops',
      json_dir: 'json',
      metadata_dir: 'metadata',
      reports_dir: 'metadata/reports',
      pre_publish_preview_summary: 'metadata/reports/pre-publish-preview-summary.json'
    }
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  fs.writeFileSync(path.join(outDir, 'extraction_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  // 5. Build Staged Items and Pre-Match against Live DB (Read-Only)
  const stagedItems = canonicalOffers.map((c, i) => {
    return {
      id: `noori-p001-i${String(i + 1).padStart(3, '0')}`,
      canonicalJsonPath: path.join(outDir, 'json', `page-001-${String(i + 1).padStart(3, '0')}.canonical.json`),
      pageNumber: 1,
      offerIndexOnPage: i + 1,
      croppedEvidenceLocalPath: path.join(outDir, `crops/offer-${String(i + 1).padStart(3, '0')}/offer_card_crop.webp`),
      originalOcr: {
        titleEn: c.offer.title_en,
        titleAr: c.offer.title_ar,
        brand: c.offer.brand,
        sizeOrWeight: c.offer.size_or_weight,
        priceBefore: c.offer.price_before,
        priceAfter: c.offer.price_after,
        discountPercent: c.offer.discount_percentage
      },
      currentOffer: {
        titleEn: c.offer.title_en,
        titleAr: c.offer.title_ar,
        brand: c.offer.brand,
        sizeOrWeight: c.offer.size_or_weight,
        priceBefore: c.offer.price_before,
        priceAfter: c.offer.price_after,
        discountPercent: c.offer.discount_percentage
      },
      brand_name: c.offer.brand,
      each_size_value: c.content.each_size_value,
      each_size_unit: c.content.each_size_unit,
      inner_pack_count: c.content.inner_pack_count,
      sale_unit_type: c.content.sale_unit_type
    }
  })

  const supabase = getSupabaseAdminClient()
  const mapFilePath = path.join(outDir, 'offer-image-ref-map.json')

  console.log('\n--- Executing Staged Pre-Matching on Noori Batch ---')
  const preMatchRes = await preMatchLocalOffersAgainstDb(stagedItems as any, {
    supabaseClient: supabase,
    mapFilePath
  })

  console.log('Pre-Match Results on Noori Batch:')
  console.log(`- Matched with DB image: ${preMatchRes.matchedWithExistingDbImageCount}`)
  console.log(`- Matched product without image: ${preMatchRes.matchedProductWithoutImageCount}`)
  console.log(`- Unmatched offers needing image: ${preMatchRes.unmatchedOfferCount}`)
  console.log(`- Total Exportable to Step 1 CSV: ${preMatchRes.exportableCount}`)

  for (const it of stagedItems) {
    console.log(`- [${it.id}] "${it.currentOffer.titleEn}" -> Matched Product: ${(it as any).matchedProductId ?? 'UNMATCHED'} | Image Ref: ${(it as any).imageRef}`)
  }

  // 6. Test Specific Pack-Count Contradiction on Fakieh 10x600g against Product 5 (1x600g)
  console.log('\n--- Invariant Check: Fakieh 10x600g vs Product 5 (1x600g) ---')
  const { data: dbFakieh } = await supabase.from('products').select('*').eq('id', 5).single()
  const fakiehItem = stagedItems[1]
  const fakiehComp = validateProductIdentityCompatibility(fakiehItem as any, dbFakieh)
  console.log(`Is Fakieh 10x600g compatible with Product 5 (1x600g)?: ${fakiehComp.isCompatible}`)
  console.log(`Rejection reason: ${fakiehComp.reason}`)

  // 7. Save Staged Draft and Export Step 1 CSV
  const draft = {
    schemaVersion: 'wifran.staged.draft/1.0',
    jobDir: outDir,
    leafletHash: 'noori-supermarket-229796668-jeddah.pdf',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    header: {
      supermarketId: null, // Will resolve to new Noori supermarket upon publish
      region: 'Western Region',
      validFrom: '2026-11-02',
      validTo: '2026-11-11',
      firstPagePublicUrl: null,
      lastPagePublicUrl: null,
      firstPageTmpPath: null,
      lastPageTmpPath: null,
      metadataPageNumber: 1,
      headerModifiedByOperator: false
    },
    items: stagedItems
  }
  await saveStagedLeafletDraft(outDir, draft as any)
  console.log('\n[Staged Draft] Saved staged-draft.json')

  const exportedStep1 = await exportStagedLeafletForStep2(outDir, {
    mapFilePath
  })
  console.log('\n--- Step 1 CSV Generated Literal Output ---')
  console.log(exportedStep1.csvContent.trim())

  // 8. Run Pre-Publish Preview Summary
  console.log('\n--- Pre-Publish Preview Validation ---')
  const prePublishSummary = await buildPrePublishSummary(outDir)
  console.log('Pre-Publish Summary Counts:', prePublishSummary.counts)

  console.log('\n[SUCCESS] Canary preparation complete. Zero database writes performed.')
}

prepareNooriCanary().catch(console.error)

