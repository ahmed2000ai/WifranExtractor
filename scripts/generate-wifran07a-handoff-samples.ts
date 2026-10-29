import fs from 'fs';
import path from 'path';
import type { CanonicalOffer } from '../src/shared/types/canonicalOffer';
import {
  buildContractV2FromCanonical,
  toConsumerOfferProjection
} from '../src/shared/utils/extractorContractV2Adapter';
import { mapPreparedPayloadToOffersInsert } from '../src/shared/utils/offerSyncMapper';

function assertNoWindowsPaths(obj: any, label: string) {
  const check = (val: any, p: string) => {
    if (val === null || val === undefined) return;
    if (typeof val === 'string') {
      if (/^[a-zA-Z]:[\\/]/.test(val) || val.includes('\\Work\\') || val.includes('/Work/')) {
        throw new Error(`Forbidden workstation path detected in ${label} at path ${p}: "${val}"`);
      }
    } else if (Array.isArray(val)) {
      val.forEach((item, idx) => check(item, `${p}[${idx}]`));
    } else if (typeof val === 'object') {
      for (const k of Object.keys(val)) {
        check(val[k], `${p}.${k}`);
      }
    }
  };
  check(obj, 'root');
}

async function main() {
  console.log('====================================================================');
  console.log('GENERATING WIFRAN-07A SAMPLES & POST-UPLOAD RECONCILIATION FIXTURES');
  console.log('====================================================================');

  const rootDir = process.cwd();
  const v4ExpectedDir = path.join(rootDir, 'tests/fixtures/wifran04/expected-v2');
  const postUploadDir = path.join(rootDir, 'tests/fixtures/wifran04/post-upload-samples');
  fs.mkdirSync(v4ExpectedDir, { recursive: true });
  fs.mkdirSync(postUploadDir, { recursive: true });

  // 1. Load canonical sources
  const j1SrcPath = path.join(rootDir, 'tests/fixtures/wifran04/page-001-012.canonical.json');
  const j2SrcPath = path.join(rootDir, 'tests/fixtures/wifran04/page-003-012.canonical.json');
  const j3SrcPath = path.join(rootDir, 'Extracts/Alwafa_Test/json/page-002-002.canonical.json');

  const j1Raw: CanonicalOffer = JSON.parse(fs.readFileSync(j1SrcPath, 'utf8'));
  const j2Raw: CanonicalOffer = JSON.parse(fs.readFileSync(j2SrcPath, 'utf8'));
  const j3Raw: CanonicalOffer = JSON.parse(fs.readFileSync(j3SrcPath, 'utf8'));

  // Ensure J1 and J2 have Alwafa city Jeddah context & supersedes tamimi
  const alwafaContext = {
    supermarket_id: 'c2cc16c2-0008-4444-b000-c00000000008',
    supermarket_slug: 'alwafa',
    location_scope: 'city' as const,
    city_id: 'a6f7b140-0002-4444-a000-000000000002',
    region_id: 'b144b6c8-2222-4444-b000-000000000002',
    offer_start_date: '2026-10-14',
    offer_end_date: '2026-10-20'
  };

  j1Raw.source.leaflet_id = 'alwafa-city-jeddah-2026-10-20';
  j1Raw.trusted_context = { ...alwafaContext };
  (j1Raw as any).supersedes_source_offer_id = 'tamimi-national-national-2026-10-20:p001:i012:s01';

  j2Raw.source.leaflet_id = 'alwafa-city-jeddah-2026-10-20';
  j2Raw.trusted_context = { ...alwafaContext };
  (j2Raw as any).supersedes_source_offer_id = 'tamimi-national-national-2026-10-20:p003:i012:s01';

  j3Raw.source.leaflet_id = 'alwafa-city-jeddah-2026-10-20';
  j3Raw.trusted_context = { ...alwafaContext };

  // 2. Build Pre-upload v2 shadow fixtures
  const j1V2 = buildContractV2FromCanonical(j1Raw, {
    supersedesSourceOfferId: 'tamimi-national-national-2026-10-20:p001:i012:s01'
  });
  j1Raw.schema_version = 'wifran.extractor.offer/2.0';
  j1Raw.contract_v2 = j1V2;

  const j2V2 = buildContractV2FromCanonical(j2Raw, {
    supersedesSourceOfferId: 'tamimi-national-national-2026-10-20:p003:i012:s01'
  });
  j2Raw.schema_version = 'wifran.extractor.offer/2.0';
  j2Raw.contract_v2 = j2V2;

  const j3V2 = buildContractV2FromCanonical(j3Raw);
  j3Raw.schema_version = 'wifran.extractor.offer/2.0';
  j3Raw.contract_v2 = j3V2;

  // Save updated pre-upload fixtures
  fs.writeFileSync(path.join(v4ExpectedDir, 'J1-dove-soap.v2.json'), JSON.stringify(j1Raw, null, 2), 'utf8');
  fs.writeFileSync(path.join(v4ExpectedDir, 'J2-mini-fan.v2.json'), JSON.stringify(j2Raw, null, 2), 'utf8');
  fs.writeFileSync(path.join(v4ExpectedDir, 'J3-ethiopian-mutton.v2.json'), JSON.stringify(j3Raw, null, 2), 'utf8');
  fs.writeFileSync(j3SrcPath, JSON.stringify(j3Raw, null, 2), 'utf8');

  console.log('✓ Pre-upload v2 fixtures updated successfully.');

  // 3. Generate Post-Upload Database Rows and Consumer View DTOs
  const samples = [
    {
      id: 'J1-dove-soap',
      raw: j1Raw,
      cardPath: 'alwafa/2026-10-14/alwafa-city-jeddah-2026-10-20/p001_012.webp',
      thumbPath: 'alwafa/2026-10-14/alwafa-city-jeddah-2026-10-20/p001_012_thumb.webp'
    },
    {
      id: 'J2-mini-fan',
      raw: j2Raw,
      cardPath: 'alwafa/2026-10-14/alwafa-city-jeddah-2026-10-20/p003_012.webp',
      thumbPath: 'alwafa/2026-10-14/alwafa-city-jeddah-2026-10-20/p003_012_thumb.webp'
    },
    {
      id: 'J3-ethiopian-mutton',
      raw: j3Raw,
      cardPath: 'alwafa/2026-10-14/alwafa-city-jeddah-2026-10-20/p002_002.webp',
      thumbPath: 'alwafa/2026-10-14/alwafa-city-jeddah-2026-10-20/p002_002_thumb.webp'
    }
  ];

  for (const s of samples) {
    const publicBase = 'https://pub-wifran.r2.dev/offer-images';
    const cardUrl = `${publicBase}/${s.cardPath}`;
    const thumbUrl = `${publicBase}/${s.thumbPath}`;

    // Post-upload canonical representation
    const postUploadCanonical: CanonicalOffer = JSON.parse(JSON.stringify(s.raw));
    postUploadCanonical.image = {
      image_bucket: 'offer-images',
      image_path: s.cardPath,
      image_url: cardUrl,
      thumbnail_path: s.thumbPath,
      thumbnail_url: thumbUrl,
      image_source_type: 'leaflet_crop'
    };

    // Rebuild contract v2 reflecting post-upload state
    const postUploadContractV2 = JSON.parse(JSON.stringify(postUploadCanonical.contract_v2!));
    postUploadContractV2.assets.offer_card.upload_state = 'uploaded';
    postUploadContractV2.assets.offer_card.storage_bucket = 'offer-images';
    postUploadContractV2.assets.offer_card.storage_object_path = s.cardPath;
    postUploadContractV2.assets.offer_card.local_path_internal = null; // Stripped post upload

    postUploadContractV2.assets.product_thumbnail.upload_state = 'uploaded';
    postUploadContractV2.assets.product_thumbnail.storage_bucket = 'offer-images';
    postUploadContractV2.assets.product_thumbnail.storage_object_path = s.thumbPath;
    postUploadContractV2.assets.product_thumbnail.local_path_internal = null; // Stripped post upload

    postUploadCanonical.contract_v2 = postUploadContractV2;

    // Convert to Database Row Payload using mapper
    const prep = {
      ...postUploadCanonical,
      leaflet_id: postUploadCanonical.source.leaflet_id,
      source_page_number: postUploadCanonical.source.source_page_number,
      source_item_number: postUploadCanonical.source.source_item_number,
      supermarket_id: postUploadCanonical.trusted_context?.supermarket_id,
      location_scope: postUploadCanonical.trusted_context?.location_scope,
      city_id: postUploadCanonical.trusted_context?.city_id,
      region_id: postUploadCanonical.trusted_context?.region_id,
      offer_start_date: postUploadCanonical.trusted_context?.offer_start_date,
      offer_end_date: postUploadCanonical.trusted_context?.offer_end_date,
      title_ar: postUploadCanonical.product?.title_ar,
      title_en: postUploadCanonical.product?.title_en,
      category_slug: postUploadCanonical.product?.category_hint,
      commodity_tag: postUploadContractV2.product_facts.derived_subcategory_slug || postUploadCanonical.product?.commodity_tag,
      item_domain: postUploadCanonical.product?.item_domain,
      brand_name: postUploadContractV2.product_facts.brand_assertion.value,
      offer_price: postUploadCanonical.prices?.offer_price,
      original_price: postUploadCanonical.prices?.original_price,
      price_basis: postUploadCanonical.prices?.price_basis,
      currency: 'SAR',
      sale_unit_type: postUploadContractV2.quantity_semantics.sale_unit,
      inner_pack_count: postUploadContractV2.quantity_semantics.inner_count,
      contract_v2: postUploadContractV2
    };

    const { payload: dbRow } = mapPreparedPayloadToOffersInsert({
      preparedPayload: prep,
      imageUrl: cardUrl,
      storageBucket: 'offer-images',
      storagePath: s.cardPath,
      thumbnailUrl: thumbUrl,
      thumbnailStoragePath: s.thumbPath,
      sourceId: null
    });

    // Strip any lingering local path keys from the persisted DB row
    delete (dbRow as any).local_path_internal;
    if (dbRow.contract_v2?.assets?.offer_card) {
      dbRow.contract_v2.assets.offer_card.local_path_internal = null;
    }
    if (dbRow.contract_v2?.assets?.product_thumbnail) {
      dbRow.contract_v2.assets.product_thumbnail.local_path_internal = null;
    }

    // Verify ZERO Windows paths in DB row
    assertNoWindowsPaths(dbRow, `${s.id} post-upload db row`);

    // Consumer View DTO
    const consumerDto = toConsumerOfferProjection(postUploadCanonical, '2026-10-16');
    assertNoWindowsPaths(consumerDto, `${s.id} consumer view dto`);

    const dbRowFile = path.join(postUploadDir, `${s.id}.post-upload-db-row.json`);
    const consumerDtoFile = path.join(postUploadDir, `${s.id}.consumer-view-dto.json`);

    fs.writeFileSync(dbRowFile, JSON.stringify(dbRow, null, 2), 'utf8');
    fs.writeFileSync(consumerDtoFile, JSON.stringify(consumerDto, null, 2), 'utf8');

    console.log(`✓ Generated post-upload samples for ${s.id}`);
  }

  console.log('\nAll WIFRAN-07A fixtures and post-upload samples generated successfully with zero path leaks!');
}

main().catch(err => {
  console.error('Sample generation failed:', err);
  process.exit(1);
});
