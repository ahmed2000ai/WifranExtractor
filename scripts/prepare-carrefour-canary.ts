import fs from 'fs'
import path from 'path'
import sharp from 'sharp'

async function prepareCarrefourCanary() {
  console.log('=== PREPARING CARREFOUR UNCONDITIONAL CANARY PACKAGE (002M) ===')

  const baseDir = path.resolve(process.cwd(), 'tmp/carrefour_canary_002m')
  const jsonDir = path.join(baseDir, 'json')
  const cropsDir = path.join(baseDir, 'crops')

  fs.mkdirSync(jsonDir, { recursive: true })
  fs.mkdirSync(path.join(cropsDir, 'offer-001'), { recursive: true })
  fs.mkdirSync(path.join(cropsDir, 'offer-002'), { recursive: true })
  fs.mkdirSync(path.join(cropsDir, 'offer-003'), { recursive: true })

  // 1. Generate crops from temp/carrefour-62797202-jeddah_p1.1.png
  const srcPage = path.resolve(process.cwd(), 'temp/carrefour-62797202-jeddah_p1.1.png')

  // Card 1: Nestle Pure Life Water
  await sharp(srcPage)
    .extract({ left: 20, top: 575, width: 245, height: 205 })
    .webp({ quality: 90 })
    .toFile(path.join(cropsDir, 'offer-001', 'offer_card_crop.webp'))

  // Card 2: Nadec Cooking Cream
  await sharp(srcPage)
    .extract({ left: 275, top: 575, width: 245, height: 205 })
    .webp({ quality: 90 })
    .toFile(path.join(cropsDir, 'offer-002', 'offer_card_crop.webp'))

  // Card 3: Sadia Frozen Chicken
  await sharp(srcPage)
    .extract({ left: 530, top: 575, width: 250, height: 205 })
    .webp({ quality: 90 })
    .toFile(path.join(cropsDir, 'offer-003', 'offer_card_crop.webp'))

  console.log('Crops generated in webp format.')

  // 2. Canonical JSONs
  const canonicalItems = [
    {
      offer: {
        title_en: 'Nestle Pure Life Water 330ml x 40',
        title_ar: 'نستله مياه بيور لايف 330 مل × 40',
        brand: 'Nestle',
        size_or_weight: '330ml x 40',
        price_before: 23.50,
        offer_price: 11.50,
        price_after: 11.50,
        discount_percentage: 51.06,
        promo_notes: null
      },
      product: {
        title_en: 'Nestle Pure Life Water 330ml x 40',
        title_ar: 'نستله مياه بيور لايف 330 مل × 40',
        brand_text: 'Nestle'
      },
      prices: {
        original_price: 23.50,
        offer_price: 11.50,
        discount_percentage: 51.06
      },
      content: {
        size_text: '330ml x 40',
        each_size_value: 330,
        each_size_unit: 'ml',
        inner_pack_count: 40,
        sale_unit_type: 'pack'
      },
      promotion: {
        promo_mechanic: 'markdown',
        quantity_limit: null,
        quantity_limit_value: null,
        is_loyalty_required: false,
        min_basket_spend: null
      },
      source: {
        page_number: 1,
        offer_index: 1,
        source_offer_id: 'carrefour-city-jeddah-2026-11-10:p001:i001:s01'
      },
      quality: {
        publish_decision: 'publish'
      }
    },
    {
      offer: {
        title_en: 'Nadec Cooking Cream 1L',
        title_ar: 'نادك كريمة للطبخ 1 لتر',
        brand: 'Nadec',
        size_or_weight: '1L',
        price_before: 23.50,
        offer_price: 14.99,
        price_after: 14.99,
        discount_percentage: 36.21,
        promo_notes: null
      },
      product: {
        title_en: 'Nadec Cooking Cream 1L',
        title_ar: 'نادك كريمة للطبخ 1 لتر',
        brand_text: 'Nadec'
      },
      prices: {
        original_price: 23.50,
        offer_price: 14.99,
        discount_percentage: 36.21
      },
      content: {
        size_text: '1L',
        each_size_value: 1,
        each_size_unit: 'l',
        inner_pack_count: 1,
        sale_unit_type: 'each'
      },
      promotion: {
        promo_mechanic: 'markdown',
        quantity_limit: null,
        quantity_limit_value: null,
        is_loyalty_required: false,
        min_basket_spend: null
      },
      source: {
        page_number: 1,
        offer_index: 2,
        source_offer_id: 'carrefour-city-jeddah-2026-11-10:p001:i002:s01'
      },
      quality: {
        publish_decision: 'publish'
      }
    },
    {
      offer: {
        title_en: 'Sadia Frozen Chicken 10x900g',
        title_ar: 'ساديا دجاج مجمد 900 جرام × 10',
        brand: 'Sadia',
        size_or_weight: '900g x 10',
        price_before: 170.00,
        offer_price: 122.99,
        price_after: 122.99,
        discount_percentage: 27.65,
        promo_notes: null
      },
      product: {
        title_en: 'Sadia Frozen Chicken 10x900g',
        title_ar: 'ساديا دجاج مجمد 900 جرام × 10',
        brand_text: 'Sadia'
      },
      prices: {
        original_price: 170.00,
        offer_price: 122.99,
        discount_percentage: 27.65
      },
      content: {
        size_text: '900g x 10',
        each_size_value: 900,
        each_size_unit: 'g',
        inner_pack_count: 10,
        sale_unit_type: 'pack'
      },
      promotion: {
        promo_mechanic: 'markdown',
        quantity_limit: null,
        quantity_limit_value: null,
        is_loyalty_required: false,
        min_basket_spend: null
      },
      source: {
        page_number: 1,
        offer_index: 3,
        source_offer_id: 'carrefour-city-jeddah-2026-11-10:p001:i003:s01'
      },
      quality: {
        publish_decision: 'publish'
      }
    }
  ]

  canonicalItems.forEach((item, idx) => {
    const filename = `page-001-00${idx + 1}.canonical.json`
    fs.writeFileSync(path.join(jsonDir, filename), JSON.stringify(item, null, 2))
  })
  console.log('Canonical JSONs written.')

  // 3. Staged Draft
  const stagedDraft = {
    schemaVersion: 'wifran.staged.draft/1.0',
    jobDir: baseDir,
    leafletHash: 'carrefour-62797202-jeddah.pdf',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    header: {
      supermarketId: 'c2cc16c2-0006-4444-b000-c00000000006', // Carrefour
      region: 'Western Region',
      regionId: 'b144b6c8-2222-4444-b000-000000000002',
      cityId: 'a6f7b140-0002-4444-a000-000000000002', // Jeddah
      locationScope: 'city',
      validFrom: '2026-11-04',
      validTo: '2026-11-10',
      firstPagePublicUrl: null,
      lastPagePublicUrl: null,
      firstPageTmpPath: null,
      lastPageTmpPath: null,
      metadataPageNumber: 1,
      headerModifiedByOperator: false
    },
    items: canonicalItems.map((c, idx) => ({
      id: `carrefour-p001-i00${idx + 1}`,
      sourceOfferId: c.source.source_offer_id,
      canonicalJsonPath: path.join(jsonDir, `page-001-00${idx + 1}.canonical.json`),
      pageNumber: 1,
      offerIndexOnPage: idx + 1,
      croppedEvidenceLocalPath: path.join(cropsDir, `offer-00${idx + 1}`, 'offer_card_crop.webp'),
      originalOcr: {
        titleEn: c.offer.title_en,
        titleAr: c.offer.title_ar,
        brand: c.offer.brand,
        sizeOrWeight: c.offer.size_or_weight,
        priceBefore: c.offer.price_before,
        priceAfter: c.offer.price_after,
        discountPercent: c.offer.discount_percentage,
        promoNotes: c.offer.promo_notes
      },
      currentOffer: {
        titleEn: c.offer.title_en,
        titleAr: c.offer.title_ar,
        brand: c.offer.brand,
        sizeOrWeight: c.offer.size_or_weight,
        priceBefore: c.offer.price_before,
        priceAfter: c.offer.price_after,
        discountPercent: c.offer.discount_percentage,
        promoNotes: c.offer.promo_notes
      },
      titleEn: c.offer.title_en,
      titleAr: c.offer.title_ar,
      brand: c.offer.brand,
      sizeOrWeight: c.offer.size_or_weight,
      priceBefore: c.offer.price_before,
      priceAfter: c.offer.price_after,
      discountPercent: c.offer.discount_percentage,
      promoNotes: c.offer.promo_notes,
      brand_name: c.offer.brand,
      each_size_value: c.content.each_size_value,
      each_size_unit: c.content.each_size_unit,
      inner_pack_count: c.content.inner_pack_count,
      sale_unit_type: c.content.sale_unit_type,
      quantity_limit: null,
      quantity_limit_value: null,
      selectedImageSource: 'none',
      status: 'ready',
      isAiCorrected: false,
      isOperatorModified: false,
      operatorEditedFields: [],
      catalogMatchIssue: 'No candidate products supplied or discovered for matching.',
      matchedVisualSubjectKey: `generic:${c.offer.title_en.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      imageRef: `O${idx + 1}`,
      existingDbImageUrl: null
    }))
  }

  fs.writeFileSync(path.join(baseDir, 'staged-draft.json'), JSON.stringify(stagedDraft, null, 2))
  console.log('staged-draft.json written.')

  // 4. Manifest
  const manifest = {
    schema_version: 'wifran.extraction.manifest/1.0',
    pdf_file_name: 'carrefour-62797202-jeddah.pdf',
    supermarket: {
      id: 'c2cc16c2-0006-4444-b000-c00000000006',
      name_en: 'Carrefour',
      name_ar: 'كارفور',
      slug: 'carrefour'
    },
    location: {
      city_id: 'a6f7b140-0002-4444-a000-000000000002',
      region_id: 'b144b6c8-2222-4444-b000-000000000002',
      location_scope: 'city'
    },
    offer_dates: {
      valid_from: '2026-11-04',
      valid_to: '2026-11-10'
    },
    extraction_status: 'completed',
    page_count: 1,
    items_count: 3
  }
  fs.writeFileSync(path.join(baseDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log('manifest.json written.')

  console.log('=== PREPARATION COMPLETE ===')
}

prepareCarrefourCanary().catch(console.error)

