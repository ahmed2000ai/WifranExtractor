/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import sharp from 'sharp';
import { BatchOrchestrationService } from '../batchOrchestrationService';
import { createIsolatedWifranPostgres } from '../../db/__tests__/isolatedPostgresHarness008';
import type { SqlQueryable } from '../../db/schemaCompatibilityService';
import { createInMemoryStorageAdapter } from '../../storage/stagedStorageLifecycleService';
import { CatalogPublicationService } from '../../db/catalogPublicationService';
import { VerifiedMatchCacheService } from '../../db/verifiedMatchCacheService';
import { evaluateIdentitySufficiency } from '../../db/productIdentityPolicy';
import { assessOfferPublicationOutcome } from '../../../shared/utils/nonCatalogPublicationPolicy';
import { generateDerivedTierProductCropsFromGeometry } from '../../ocr/hybrid/hybridCropGenerator';
import type { BatchManifest, UnifiedBatchOffer } from '../../../shared/types/batchExtraction';
import type { MatchingRunManifest } from '../../../shared/types/catalogMatching';

async function createMinimalWebp(filePath: string, rgb: { r: number; g: number; b: number }): Promise<string> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: rgb
    }
  })
    .webp()
    .toFile(filePath);
  return filePath;
}

describe('WIFRAN — Controlled Identity & Consumer Image Repair, Precedence & Prevention', () => {
  let tmpRoot: string;
  let batchesDir: string;
  let workspaceDir: string;
  let batchId: string;
  let pgClient: SqlQueryable;
  let closeDb: () => Promise<void>;

  const SUPERMARKET_ID = 'sup_nokhbah';

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-repair-suite-'));
    batchesDir = path.join(tmpRoot, 'batches');
    workspaceDir = path.join(tmpRoot, 'alnokhbah-markets-1');
    fs.mkdirSync(batchesDir, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });

    const { client, db } = await createIsolatedWifranPostgres();
    pgClient = client;
    closeDb = async () => {
      await db.close();
    };

    await pgClient.query(
      `INSERT INTO public.supermarkets (id, name_en, name_ar, slug, code)
       VALUES ($1, 'Al Nokhbah Markets', 'أسواق النخبة', 'al-nokhbah', 'NOKH')
       ON CONFLICT (id) DO NOTHING`,
      [SUPERMARKET_ID]
    );

    batchId = 'batch-2026-11-16T08-39-30-dacbb8';
  });

  afterEach(async () => {
    await closeDb?.();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('1. Upstream prevention: keeps 5kg vs 10kg temporary groups separate in public.products and blocks assortments from single-SKU linking', async () => {
    const p5Thumb = await createMinimalWebp(path.join(workspaceDir, 'crops', 'rice_5kg', 'product_thumb_crop.webp'), { r: 200, g: 150, b: 80 });
    const p10Thumb = await createMinimalWebp(path.join(workspaceDir, 'crops', 'rice_10kg', 'product_thumb_crop.webp'), { r: 200, g: 150, b: 90 });
    const assortThumb = await createMinimalWebp(path.join(workspaceDir, 'crops', 'water_assort', 'product_thumb_crop.webp'), { r: 50, g: 160, b: 220 });
    const cardCrop = await createMinimalWebp(path.join(workspaceDir, 'crops', 'shared_card', 'offer_card_crop.webp'), { r: 10, g: 10, b: 10 });

    const makeOffer = (overrides: Partial<UnifiedBatchOffer>): UnifiedBatchOffer => ({
      batchOfferKey: 'k',
      batchId,
      leafletId: 'leaflet-001',
      sourceDocumentId: 'doc_nokh',
      sourceFileName: 'alnokhbah.pdf',
      sourcePdfPath: 'C:\\alnokhbah.pdf',
      sourcePage: 18,
      sourceOfferId: 'id',
      supermarketId: SUPERMARKET_ID,
      supermarketName: 'Al Nokhbah Markets',
      locationScope: 'national',
      locationLabel: 'National',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-11-16',
      offerEndDate: '2026-11-30',
      currency: 'SAR',
      titleAr: 'أرز بسمتي',
      titleEn: 'Creamy Sella Long Grain Basmati Rice',
      brand: 'Al Bayt',
      brandEn: 'Al Bayt',
      brandAr: 'البيت',
      promoPrice: 39.95,
      originalPrice: null,
      discountPercent: null,
      promoNotes: null,
      sizeOrWeight: '5 kg',
      each_size_value: 5,
      each_size_unit: 'kg',
      inner_pack_count: 1,
      sale_unit_type: 'piece',
      total_content_value: 5,
      total_content_unit: 'kg',
      free_units_text: null,
      customer_limit: null,
      offerCardCropPath: cardCrop,
      productThumbCropPath: p5Thumb,
      consumerProductImagePath: p5Thumb,
      consumerImageApprovalStatus: 'approved_generated_crop',
      imageSubjectScope: 'product_package',
      conflictCodes: [],
      quarantineReasons: [],
      status: 'extracted',
      confidence: 'high',
      warnings: [],
      blockingErrors: [],
      ...overrides
    });

    const offer5kg = makeOffer({
      batchOfferKey: `${batchId}:leaflet-001:18:leaflet-001_p018_011__tier_1`,
      sourceOfferId: 'leaflet-001_p018_011__tier_1',
      promoPrice: 39.95,
      each_size_value: 5,
      productThumbCropPath: p5Thumb,
      consumerProductImagePath: p5Thumb
    });

    const offer10kg = makeOffer({
      batchOfferKey: `${batchId}:leaflet-001:18:leaflet-001_p018_011__tier_2`,
      sourceOfferId: 'leaflet-001_p018_011__tier_2',
      promoPrice: 66.95,
      each_size_value: 10,
      productThumbCropPath: p10Thumb,
      consumerProductImagePath: p10Thumb
    });

    const offerAssort = makeOffer({
      batchOfferKey: `${batchId}:leaflet-001:1:leaflet-001_p001_010`,
      sourceOfferId: 'leaflet-001_p001_010',
      sourcePage: 1,
      titleEn: 'Low Sodium Bottled Drinking Water',
      titleAr: 'مياه معبأة قليلة الصوديوم',
      brand: 'Al Nokhba',
      brandEn: 'Al Nokhba',
      brandAr: 'النخبة',
      promoPrice: 6.99,
      each_size_value: 200,
      each_size_unit: 'ml',
      inner_pack_count: 48,
      sale_unit_type: 'pack',
      assortment_status: 'explicit_assortment',
      v3RetentionMode: 'decomposed_shared_promo_parent',
      imageSubjectScope: 'representative_assortment',
      productThumbCropPath: assortThumb,
      consumerProductImagePath: assortThumb,
      consumerDisplayImagePath: assortThumb,
      canonical: {
        reconciled_v3: {
          assortment: { status: 'explicit_assortment' },
          sub_items: [
            { sub_item_ref: 's01', each_size_value: 200, each_size_unit: 'ml', manufacturer_pack_count: 48 },
            { sub_item_ref: 's02', each_size_value: 330, each_size_unit: 'ml', manufacturer_pack_count: 40 }
          ]
        }
      }
    });

    // Verify policy blocks assortment from single-SKU identity sufficiency
    const assortSuf = evaluateIdentitySufficiency(
      {
        brandKey: 'al_nokhba',
        brandNameEn: 'Al Nokhba',
        brandNameAr: 'النخبة',
        brandStatus: 'known',
        productNameEn: 'Low Sodium Bottled Drinking Water',
        productNameAr: 'مياه معبأة قليلة الصوديوم',
        eachSizeValue: 200,
        eachSizeUnit: 'ml',
        innerPackCount: 48,
        saleUnitType: 'pack',
        packagingSemantics: 'manufacturer_multipack',
        assortmentStatus: 'explicit_assortment'
      },
      offerAssort
    );
    expect(assortSuf.isAssortment).toBe(true);
    expect(assortSuf.isSufficient).toBe(false);
    expect(assortSuf.codes).toContain('STRUCTURED_ASSORTMENT_STATUS');

    // Even if a legacy temporary proposal existed for offerAssort, nonCatalogPolicy refuses single-SKU link
    const matchingManifest: MatchingRunManifest = {
      schemaVersion: '1.0',
      batchId,
      runId: 'run_prevent',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'completed',
      matchingDatabaseContext: 'DEVELOPMENT_TEST',
      model: 'deterministic',
      thinkingLevel: 'MEDIUM',
      executionMode: 'flex',
      totals: {
        totalExtractedOffers: 3,
        uniqueIdentitiesCount: 3,
        cacheMatchesCount: 0,
        deterministicMatchesCount: 0,
        geminiEvaluatedCount: 0,
        proposedExistingCount: 0,
        proposedTemporaryCount: 3,
        unresolvedCount: 0,
        validationWarningsCount: 0,
        actualCostUsd: 0,
        estimatedCostUsd: 0,
        geminiRequestsCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0
      },
      proposals: {
        [offer5kg.batchOfferKey]: {
          batchOfferKey: offer5kg.batchOfferKey,
          sourceOfferId: offer5kg.sourceOfferId,
          sourcePage: 18,
          leafletId: 'leaflet-001',
          supermarketName: 'Al Nokhbah Markets',
          decision: 'temporary',
          matchedProductId: null,
          matchedProduct: null,
          temporaryId: 't_5kg',
          confidence: 'medium',
          matchMethod: 'deterministic',
          validationIssues: [],
          operatorDecision: 'proposed',
          updatedAt: new Date().toISOString()
        },
        [offer10kg.batchOfferKey]: {
          batchOfferKey: offer10kg.batchOfferKey,
          sourceOfferId: offer10kg.sourceOfferId,
          sourcePage: 18,
          leafletId: 'leaflet-001',
          supermarketName: 'Al Nokhbah Markets',
          decision: 'temporary',
          matchedProductId: null,
          matchedProduct: null,
          temporaryId: 't_10kg',
          confidence: 'medium',
          matchMethod: 'deterministic',
          validationIssues: [],
          operatorDecision: 'proposed',
          updatedAt: new Date().toISOString()
        },
        [offerAssort.batchOfferKey]: {
          batchOfferKey: offerAssort.batchOfferKey,
          sourceOfferId: offerAssort.sourceOfferId,
          sourcePage: 1,
          leafletId: 'leaflet-001',
          supermarketName: 'Al Nokhbah Markets',
          decision: 'temporary',
          matchedProductId: null,
          matchedProduct: null,
          temporaryId: 't_assort_should_block',
          confidence: 'medium',
          matchMethod: 'deterministic',
          validationIssues: [],
          operatorDecision: 'proposed',
          updatedAt: new Date().toISOString()
        }
      },
      temporaryProducts: {
        t_5kg: {
          temporaryId: 't_5kg',
          canonicalFingerprint: 'al_bayt|rice|5000g_x1',
          brandKey: 'al_bayt',
          brandNameAr: 'البيت',
          brandNameEn: 'Al Bayt',
          productNameAr: 'أرز بسمتي',
          productNameEn: 'Creamy Sella Long Grain Basmati Rice',
          variantOrFlavor: null,
          fatContent: null,
          eachSizeValue: 5,
          eachSizeUnit: 'kg',
          innerPackCount: 1,
          saleUnitType: 'piece',
          productForm: null,
          sourceOfferKeys: [offer5kg.batchOfferKey],
          retailers: ['Al Nokhbah Markets'],
          sampleThumbCropPath: p5Thumb,
          operatorDecision: 'proposed',
          validationWarnings: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        t_10kg: {
          temporaryId: 't_10kg',
          canonicalFingerprint: 'al_bayt|rice|10000g_x1',
          brandKey: 'al_bayt',
          brandNameAr: 'البيت',
          brandNameEn: 'Al Bayt',
          productNameAr: 'أرز بسمتي',
          productNameEn: 'Creamy Sella Long Grain Basmati Rice',
          variantOrFlavor: null,
          fatContent: null,
          eachSizeValue: 10,
          eachSizeUnit: 'kg',
          innerPackCount: 1,
          saleUnitType: 'piece',
          productForm: null,
          sourceOfferKeys: [offer10kg.batchOfferKey],
          retailers: ['Al Nokhbah Markets'],
          sampleThumbCropPath: p10Thumb,
          operatorDecision: 'proposed',
          validationWarnings: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        t_assort_should_block: {
          temporaryId: 't_assort_should_block',
          canonicalFingerprint: 'al_nokhba|water|200ml_x48',
          brandKey: 'al_nokhba',
          brandNameAr: 'النخبة',
          brandNameEn: 'Al Nokhba',
          productNameAr: 'مياه معبأة قليلة الصوديوم',
          productNameEn: 'Low Sodium Bottled Drinking Water',
          variantOrFlavor: null,
          fatContent: null,
          eachSizeValue: 200,
          eachSizeUnit: 'ml',
          innerPackCount: 48,
          saleUnitType: 'pack',
          productForm: null,
          sourceOfferKeys: [offerAssort.batchOfferKey],
          retailers: ['Al Nokhbah Markets'],
          sampleThumbCropPath: assortThumb,
          operatorDecision: 'proposed',
          validationWarnings: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      },
      brandSummaries: {},
      requests: {},
      requestOrder: []
    };

    const assortAssess = assessOfferPublicationOutcome({
      offer: offerAssort,
      proposal: matchingManifest.proposals[offerAssort.batchOfferKey],
      temporaryProducts: matchingManifest.temporaryProducts
    });
    expect(assortAssess.outcome).toBe('approved_non_catalog');
    expect(assortAssess.perUnitPricing.basisEstablished).toBe(false);

    const storageAdapter = createInMemoryStorageAdapter('https://storage.mock.local');
    const pubService = new CatalogPublicationService(new VerifiedMatchCacheService(tmpRoot, 'development'));
    const pubRes = await pubService.publishApprovedCatalogBatch({
      manifest: matchingManifest,
      offers: [offer5kg, offer10kg, offerAssort],
      context: 'DEVELOPMENT_TEST',
      pgClient,
      allowIsolatedTestDb: true,
      enableImageUpload: true,
      storageAdapter,
      operatorId: 'prevent_test'
    });
    expect(pubRes.success).toBe(true);
    expect(pubRes.publishedOffersCount).toBe(3);

    // Confirm TWO distinct products were created (5kg and 10kg never merged!) and ZERO product created for assortment
    const prods = await pgClient.query('SELECT id, name_en, each_size_value::float8, each_size_unit FROM public.products ORDER BY each_size_value');
    expect(prods.rows).toHaveLength(2);
    expect(Number(prods.rows[0].each_size_value)).toBe(5);
    expect(Number(prods.rows[1].each_size_value)).toBe(10);

    // Confirm assortment offer has product_id=NULL, unit_price=NULL, and group image in offer_display_images
    const assortDb = await pgClient.query(
      `SELECT product_id, assortment_status, unit_price FROM public.offers WHERE title_en LIKE '%Drinking Water%'`
    );
    expect(assortDb.rows[0].product_id).toBeNull();
    expect(assortDb.rows[0].assortment_status).toBe('multiple_variants');
    expect(assortDb.rows[0].unit_price).toBeNull();

    const assortOdi = await pgClient.query(`SELECT storage_bucket, public_url FROM public.offer_display_images`);
    expect(assortOdi.rows).toHaveLength(1);
    expect(assortOdi.rows[0].storage_bucket).toBe('offer-display-images');
  });

  it('2. Preflight & Controlled Repair: rejects dual-price cards, fixes all 4 10kg tiers & 3 P1 assortments, preserves 5kg SKUs & 19 imaged & 3 unpublished offers, and is idempotent', async () => {
    const batchDir = path.join(batchesDir, batchId);
    fs.mkdirSync(batchDir, { recursive: true });

    // Create Page 1 assortment crops
    const p1_010_thumb = await createMinimalWebp(path.join(workspaceDir, 'crops/page_1/leaflet-001_p001_010/product_thumb_crop.webp'), { r: 30, g: 120, b: 220 });
    const p1_014_thumb = await createMinimalWebp(path.join(workspaceDir, 'crops/page_1/leaflet-001_p001_014/product_thumb_crop.webp'), { r: 220, g: 200, b: 30 });
    const p1_015_thumb = await createMinimalWebp(path.join(workspaceDir, 'crops/page_1/leaflet-001_p001_015/product_thumb_crop.webp'), { r: 30, g: 60, b: 190 });

    // Create Page 18 rice crops:
    // 010: ONLY dual-price offer_card_crop.webp on tier_1 & tier_2 -> MUST be rejected as unsuitable!
    const p18_010_card1 = await createMinimalWebp(path.join(workspaceDir, 'crops/page_18/leaflet-001_p018_010__tier_1/offer_card_crop.webp'), { r: 90, g: 90, b: 90 });
    const p18_010_card2 = await createMinimalWebp(path.join(workspaceDir, 'crops/page_18/leaflet-001_p018_010__tier_2/offer_card_crop.webp'), { r: 90, g: 90, b: 90 });

    // 011, 012, 013: derived clean product_thumb_crop.webp + meta for tier 1 (exact) and tier 2 (requires confirmation)
    const riceCleanCrops: Record<string, { t1: string; t2: string }> = {};
    for (const num of ['011', '012', '013']) {
      const t1 = await createMinimalWebp(path.join(workspaceDir, `crops/page_18/leaflet-001_p018_${num}__tier_1/product_thumb_crop.webp`), { r: 160, g: 120, b: 80 });
      const t2 = await createMinimalWebp(path.join(workspaceDir, `crops/page_18/leaflet-001_p018_${num}__tier_2/product_thumb_crop.webp`), { r: 160, g: 120, b: 85 });
      fs.writeFileSync(
        path.join(path.dirname(t1), 'derived_tier_crop_meta.json'),
        JSON.stringify({ sizeConfirmationStatus: 'exact_tier_graphic', operatorConfirmed: false }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(path.dirname(t2), 'derived_tier_crop_meta.json'),
        JSON.stringify({ sizeConfirmationStatus: 'shared_single_graphic_requires_confirmation', operatorConfirmed: false }),
        'utf8'
      );
      riceCleanCrops[num] = { t1, t2 };
    }

    // Seed production-equivalent catalog products (Water, Lux, Omo + 4x 5kg Rice)
    const insertProd = async (nameEn: string, nameAr: string, brand: string, size: number, unit: string, pack = 1, saleUnit = 'piece') => {
      const res = await pgClient.query(
        `INSERT INTO public.products (name_en, name_ar, brand_name, each_size_value, each_size_unit, inner_pack_count, sale_unit_type, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'candidate') RETURNING id`,
        [nameEn, nameAr, brand, size, unit, pack, saleUnit]
      );
      return String(res.rows[0].id);
    };

    const oilProdId = await insertProd('100% Pure Sunflower Oil', 'زيت دوار الشمس', 'Prime', 1.5, 'L');
    const waterProdId = await insertProd('Low Sodium Bottled Drinking Water', 'مياه معبأة قليلة الصوديوم', 'Al Nokhba', 200, 'ml', 48, 'pack');
    const luxProdId = await insertProd('Dishwashing Liquid Lemon', 'سائل غسيل الصحون بالليمون', 'Lux', 725, 'ml');
    const omoProdId = await insertProd('Active Semi-Automatic Washing Powder', 'مسحوق غسيل أكتيف شبه أوتوماتيكي', 'Omo', 1.5, 'kg');
    const walimahProdId = await insertProd('Rice Long Grain White Basmathi', 'أرز بسمتي أبيض حبة طويل', 'AL WALIMAH', 5, 'kg');
    const creamyProdId = await insertProd('Creamy Sella Long Grain Basmati Rice', 'أرز بسمتي كريمي سيلا طويل الحبة', 'Al Bayt', 5, 'kg');
    const xxlProdId = await insertProd('XXL Golden Sella Long Grain Basmati Rice', 'أرز بسمتي ذهبي سيلا طويل الحبة جدا', 'AL BAYT', 5, 'kg');
    const goldenProdId = await insertProd('Golden Sella Long Grain Basmati Rice', 'أرز بسمتي ذهبي سيلا طويل الحبة', 'Al Bayt', 5, 'kg');

    // Give pre-existing imaged Oil offer its product_images row
    await pgClient.query(
      `INSERT INTO public.product_images (
        product_id, role, storage_bucket, storage_object_path, public_url,
        mime_type, byte_size, content_sha256, source_url, normalized_source_url,
        approval_status, rights_basis, reviewed_by
      ) VALUES ($1, 'primary', 'product-images', 'products/sha256/oil.webp', 'https://storage/product-images/oil.webp', 'image/webp', 1024, 'sha_oil', 'https://storage/product-images/oil.webp', 'https://storage/product-images/oil.webp', 'approved', 'operator_manual_verified', 'op')`,
      [Number(oilProdId)]
    );

    const insertOffer = async (p: {
      prodId: string;
      titleEn: string;
      titleAr: string;
      price: number;
      size: number;
      unit: string;
      pack?: number;
      saleUnit?: string;
      src: string;
      img?: string | null;
      unitPrice?: number | null;
      unitPriceUnit?: string | null;
    }) => {
      const res = await pgClient.query(
        `INSERT INTO public.offers (
          supermarket_id, product_id, title_en, title_ar, offer_start_date, offer_end_date,
          offer_price, unit_price, unit_price_unit, status, image_url, thumbnail_url, location_scope,
          source_offer_id, catalog_match_status, exact_identity_status, assortment_status,
          each_size_value, each_size_unit, inner_pack_count, sale_unit_type
        ) VALUES (
          $1, $2::bigint, $3, $4, '2026-11-16', '2026-11-30',
          $5, $6, $7, 'published', $8, $8, 'national',
          $9, 'candidate_pending_review', 'unresolved', 'unknown_composition',
          $10, $11, $12, $13
        ) RETURNING id`,
        [
          SUPERMARKET_ID,
          Number(p.prodId),
          p.titleEn,
          p.titleAr,
          p.price,
          p.unitPrice ?? null,
          p.unitPriceUnit ?? null,
          p.img ?? null,
          p.src,
          p.size,
          p.unit,
          p.pack ?? 1,
          p.saleUnit ?? 'piece'
        ]
      );
      return String(res.rows[0].id);
    };

    const oilOfferId = await insertOffer({ prodId: oilProdId, titleEn: '100% Pure Sunflower Oil', titleAr: 'زيت', price: 14.95, size: 1.5, unit: 'L', src: 'doc_nokh:p001:ip001_002:s01', img: 'https://storage/product-images/oil.webp', unitPrice: 9.97, unitPriceUnit: 'L' });
    const waterOfferId = await insertOffer({ prodId: waterProdId, titleEn: 'Low Sodium Bottled Drinking Water', titleAr: 'مياه معبأة قليلة الصوديوم', price: 6.99, size: 200, unit: 'ml', pack: 48, saleUnit: 'pack', src: 'doc_nokh:p001:ip001_010:s01', unitPrice: 0.73, unitPriceUnit: 'L' });
    const luxOfferId = await insertOffer({ prodId: luxProdId, titleEn: 'Dishwashing Liquid Lemon', titleAr: 'سائل غسيل الصحون بالليمون', price: 4.99, size: 725, unit: 'ml', src: 'doc_nokh:p001:ip001_014:s01', unitPrice: 6.88, unitPriceUnit: 'L' });
    const omoOfferId = await insertOffer({ prodId: omoProdId, titleEn: 'Active Semi-Automatic Washing Powder', titleAr: 'مسحوق غسيل أكتيف شبه أوتوماتيكي', price: 8.5, size: 1.5, unit: 'kg', src: 'doc_nokh:p001:ip001_015:s01', unitPrice: 5.67, unitPriceUnit: 'kg' });

    const walimah5Id = await insertOffer({ prodId: walimahProdId, titleEn: 'Rice Long Grain White Basmathi', titleAr: 'الوليمة أرز', price: 41.95, size: 5, unit: 'kg', src: 'doc_nokh:p018:ip018_010__tier_1:s01' });
    const walimah10Id = await insertOffer({ prodId: walimahProdId, titleEn: 'Rice Long Grain White Basmathi', titleAr: 'الوليمة أرز', price: 79.95, size: 10, unit: 'kg', src: 'doc_nokh:p018:ip018_010__tier_2:s01' });
    const creamy5Id = await insertOffer({ prodId: creamyProdId, titleEn: 'Creamy Sella Long Grain Basmati Rice', titleAr: 'البيت كريمي', price: 39.95, size: 5, unit: 'kg', src: 'doc_nokh:p018:ip018_011__tier_1:s01' });
    const creamy10Id = await insertOffer({ prodId: creamyProdId, titleEn: 'Creamy Sella Long Grain Basmati Rice', titleAr: 'البيت كريمي', price: 66.95, size: 10, unit: 'kg', src: 'doc_nokh:p018:ip018_011__tier_2:s01' });
    const xxl5Id = await insertOffer({ prodId: xxlProdId, titleEn: 'XXL Golden Sella Long Grain Basmati Rice', titleAr: 'البيت اكس اكس ال', price: 39.95, size: 5, unit: 'kg', src: 'doc_nokh:p018:ip018_012__tier_1:s01' });
    const xxl10Id = await insertOffer({ prodId: xxlProdId, titleEn: 'XXL Golden Sella Long Grain Basmati Rice', titleAr: 'البيت اكس اكس ال', price: 67.95, size: 10, unit: 'kg', src: 'doc_nokh:p018:ip018_012__tier_2:s01' });
    const golden5Id = await insertOffer({ prodId: goldenProdId, titleEn: 'Golden Sella Long Grain Basmati Rice', titleAr: 'البيت ذهبي', price: 39.95, size: 5, unit: 'kg', src: 'doc_nokh:p018:ip018_013__tier_1:s01' });
    const golden10Id = await insertOffer({ prodId: goldenProdId, titleEn: 'Golden Sella Long Grain Basmati Rice', titleAr: 'البيت ذهبي', price: 65.5, size: 10, unit: 'kg', src: 'doc_nokh:p018:ip018_013__tier_2:s01' });

    // Staged draft intentionally omits publicationState.imageUrl (just like live UAT) AND preserves 3 unpublished ready offers!
    const stagedDraft = {
      leafletId: 'leaflet-001',
      items: [
        {
          id: 'leaflet-001_p001_002',
          sourceOfferId: 'leaflet-001_p001_002',
          pageNumber: 1,
          titleEn: '100% Pure Sunflower Oil',
          titleAr: 'زيت دوار الشمس',
          priceAfter: 14.95,
          each_size_value: 1.5,
          each_size_unit: 'L',
          status: 'ready',
          publicationState: { state: 'published', offerId: oilOfferId, productId: oilProdId }
        },
        {
          id: 'leaflet-001_p001_010',
          sourceOfferId: 'leaflet-001_p001_010',
          pageNumber: 1,
          titleEn: 'Low Sodium Bottled Drinking Water',
          titleAr: 'مياه معبأة قليلة الصوديوم',
          brandEn: 'Al Nokhba',
          brandAr: 'النخبة',
          priceAfter: 6.99,
          each_size_value: 200,
          each_size_unit: 'ml',
          inner_pack_count: 48,
          assortment_status: 'explicit_assortment',
          imageSubjectScope: 'representative_assortment',
          productThumbLocalPath: p1_010_thumb,
          canonical: {
            reconciled_v3: {
              assortment: { status: 'explicit_assortment' },
              sub_items: [
                { sub_item_ref: 's01', brand_en: 'Al Nokhba', brand_ar: 'النخبة', variant_or_flavor: '48x200ml', each_size_value: 200, each_size_unit: 'ml', manufacturer_pack_count: 48 },
                { sub_item_ref: 's02', brand_en: 'Al Nokhba', brand_ar: 'النخبة', variant_or_flavor: '40x330ml', each_size_value: 330, each_size_unit: 'ml', manufacturer_pack_count: 40 }
              ]
            }
          },
          status: 'ready',
          publicationState: { state: 'published', offerId: waterOfferId, productId: waterProdId }
        },
        {
          id: 'leaflet-001_p001_014',
          sourceOfferId: 'leaflet-001_p001_014',
          pageNumber: 1,
          titleEn: 'Dishwashing Liquid Lemon',
          titleAr: 'سائل غسيل الصحون بالليمون',
          brandEn: 'Lux',
          brandAr: 'لوكس',
          priceAfter: 4.99,
          each_size_value: 725,
          each_size_unit: 'ml',
          assortment_status: 'explicit_assortment',
          imageSubjectScope: 'representative_assortment',
          productThumbLocalPath: p1_014_thumb,
          canonical: {
            reconciled_v3: {
              assortment: { status: 'explicit_assortment' },
              sub_items: [
                { sub_item_ref: 's01', brand_en: 'Lux', brand_ar: 'لوكس', variant_or_flavor: 'Lemon', each_size_value: 725, each_size_unit: 'ml', manufacturer_pack_count: 1 },
                { sub_item_ref: 's02', brand_en: 'Lux', brand_ar: 'لوكس', variant_or_flavor: 'Regular', each_size_value: 725, each_size_unit: 'ml', manufacturer_pack_count: 1 }
              ]
            }
          },
          status: 'ready',
          publicationState: { state: 'published', offerId: luxOfferId, productId: luxProdId }
        },
        {
          id: 'leaflet-001_p001_015',
          sourceOfferId: 'leaflet-001_p001_015',
          pageNumber: 1,
          titleEn: 'Active Semi-Automatic Washing Powder',
          titleAr: 'مسحوق غسيل أكتيف شبه أوتوماتيكي',
          brandEn: 'Omo',
          brandAr: 'أومو',
          priceAfter: 8.5,
          each_size_value: 1.5,
          each_size_unit: 'kg',
          assortment_status: 'explicit_assortment',
          imageSubjectScope: 'representative_assortment',
          productThumbLocalPath: p1_015_thumb,
          canonical: {
            reconciled_v3: {
              assortment: { status: 'explicit_assortment' },
              sub_items: [
                { sub_item_ref: 's01', brand_en: 'Omo', brand_ar: 'أومو', variant_or_flavor: 'Semi-Automatic', each_size_value: 1.5, each_size_unit: 'kg', manufacturer_pack_count: 1 },
                { sub_item_ref: 's02', brand_en: 'Omo', brand_ar: 'أومو', variant_or_flavor: 'Automatic', each_size_value: 1.5, each_size_unit: 'kg', manufacturer_pack_count: 1 }
              ]
            }
          },
          status: 'ready',
          publicationState: { state: 'published', offerId: omoOfferId, productId: omoProdId }
        },
        // 010: Only dual-price offer_card_crop.webp exists
        {
          id: 'leaflet-001_p018_010__tier_1',
          sourceOfferId: 'leaflet-001_p018_010__tier_1',
          pageNumber: 18,
          titleEn: 'Rice Long Grain White Basmathi',
          titleAr: 'الوليمة أرز بسمتي أبيض',
          brandEn: 'AL WALIMAH',
          priceAfter: 41.95,
          each_size_value: 5,
          each_size_unit: 'kg',
          croppedEvidenceLocalPath: p18_010_card1,
          status: 'ready',
          publicationState: { state: 'published', offerId: walimah5Id, productId: walimahProdId }
        },
        {
          id: 'leaflet-001_p018_010__tier_2',
          sourceOfferId: 'leaflet-001_p018_010__tier_2',
          pageNumber: 18,
          titleEn: 'Rice Long Grain White Basmathi',
          titleAr: 'الوليمة أرز بسمتي أبيض',
          brandEn: 'AL WALIMAH',
          priceAfter: 79.95,
          each_size_value: 10,
          each_size_unit: 'kg',
          croppedEvidenceLocalPath: p18_010_card2,
          status: 'ready',
          publicationState: { state: 'published', offerId: walimah10Id, productId: walimahProdId }
        },
        // 011, 012, 013: derived clean product crops
        {
          id: 'leaflet-001_p018_011__tier_1',
          sourceOfferId: 'leaflet-001_p018_011__tier_1',
          pageNumber: 18,
          titleEn: 'Creamy Sella Long Grain Basmati Rice',
          titleAr: 'البيت أرز بسمتي كريمي سيلا',
          brandEn: 'Al Bayt',
          priceAfter: 39.95,
          each_size_value: 5,
          each_size_unit: 'kg',
          status: 'ready',
          publicationState: { state: 'published', offerId: creamy5Id, productId: creamyProdId }
        },
        {
          id: 'leaflet-001_p018_011__tier_2',
          sourceOfferId: 'leaflet-001_p018_011__tier_2',
          pageNumber: 18,
          titleEn: 'Creamy Sella Long Grain Basmati Rice',
          titleAr: 'البيت أرز بسمتي كريمي سيلا',
          brandEn: 'Al Bayt',
          priceAfter: 66.95,
          each_size_value: 10,
          each_size_unit: 'kg',
          status: 'ready',
          publicationState: { state: 'published', offerId: creamy10Id, productId: creamyProdId }
        },
        {
          id: 'leaflet-001_p018_012__tier_1',
          sourceOfferId: 'leaflet-001_p018_012__tier_1',
          pageNumber: 18,
          titleEn: 'XXL Golden Sella Long Grain Basmati Rice',
          titleAr: 'البيت أرز بسمتي ذهبي سيلا جدا',
          brandEn: 'AL BAYT',
          priceAfter: 39.95,
          each_size_value: 5,
          each_size_unit: 'kg',
          status: 'ready',
          publicationState: { state: 'published', offerId: xxl5Id, productId: xxlProdId }
        },
        {
          id: 'leaflet-001_p018_012__tier_2',
          sourceOfferId: 'leaflet-001_p018_012__tier_2',
          pageNumber: 18,
          titleEn: 'XXL Golden Sella Long Grain Basmati Rice',
          titleAr: 'البيت أرز بسمتي ذهبي سيلا جدا',
          brandEn: 'AL BAYT',
          priceAfter: 67.95,
          each_size_value: 10,
          each_size_unit: 'kg',
          status: 'ready',
          publicationState: { state: 'published', offerId: xxl10Id, productId: xxlProdId }
        },
        {
          id: 'leaflet-001_p018_013__tier_1',
          sourceOfferId: 'leaflet-001_p018_013__tier_1',
          pageNumber: 18,
          titleEn: 'Golden Sella Long Grain Basmati Rice',
          titleAr: 'البيت أرز بسمتي ذهبي سيلا',
          brandEn: 'Al Bayt',
          priceAfter: 39.95,
          each_size_value: 5,
          each_size_unit: 'kg',
          status: 'ready',
          publicationState: { state: 'published', offerId: golden5Id, productId: goldenProdId }
        },
        {
          id: 'leaflet-001_p018_013__tier_2',
          sourceOfferId: 'leaflet-001_p018_013__tier_2',
          pageNumber: 18,
          titleEn: 'Golden Sella Long Grain Basmati Rice',
          titleAr: 'البيت أرز بسمتي ذهبي سيلا',
          brandEn: 'Al Bayt',
          priceAfter: 65.5,
          each_size_value: 10,
          each_size_unit: 'kg',
          status: 'ready',
          publicationState: { state: 'published', offerId: golden10Id, productId: goldenProdId }
        },
        // 3 unpublished ready offers (must stay untouched!)
        { id: 'leaflet-001_p001_012', sourceOfferId: 'leaflet-001_p001_012', pageNumber: 1, titleEn: 'Big Aye Croaker Rohu', status: 'ready' },
        { id: 'leaflet-001_p001_013', sourceOfferId: 'leaflet-001_p001_013', pageNumber: 1, titleEn: 'Dove Shampoo Daily Hydration — Assorted', status: 'ready' },
        { id: 'leaflet-001_p018_007', sourceOfferId: 'leaflet-001_p018_007', pageNumber: 18, titleEn: 'Prime Calrose Rice', status: 'ready' }
      ]
    };
    fs.writeFileSync(path.join(workspaceDir, 'staged-draft.json'), JSON.stringify(stagedDraft, null, 2));

    const batchManifest: BatchManifest = {
      schemaVersion: '1.0',
      batchId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'partially_published',
      workspaceDir: batchesDir,
      model: 'gemini-2.5-flash',
      extractionPipelineMode: 'hybrid_v3',
      executionMode: 'flex',
      totals: {
        totalPdfs: 1,
        completedPdfs: 1,
        failedPdfs: 0,
        cancelledPdfs: 0,
        totalPages: 2,
        pagesProcessed: 2,
        totalOffers: 15,
        totalCostUsd: 0.05
      },
      leaflets: [
        {
          leafletId: 'leaflet-001',
          fileName: 'alnokhbah.pdf',
          filePath: path.join(workspaceDir, 'alnokhbah.pdf'),
          fileSizeBytes: 1024,
          fileFingerprint: 'mock_fp',
          workspacePath: workspaceDir,
          status: 'completed',
          pageCount: 2,
          pagesProcessed: 2,
          offersCount: 15,
          estimatedCostUsd: 0.05,
          provenance: 'fresh',
          metadata: {
            supermarketName: 'Al Nokhbah Markets',
            supermarketId: SUPERMARKET_ID,
            regionId: null,
            cityId: null,
            offerStartDate: '2026-11-16',
            offerEndDate: '2026-11-30'
          }
        }
      ],
      publishedOffers: {}
    };
    fs.writeFileSync(path.join(batchDir, 'batch-manifest.json'), JSON.stringify(batchManifest, null, 2));

    const service = new BatchOrchestrationService(batchesDir);

    // A. Read-only preflight accurately detects 11 missing offers and classifies them truthfully
    const preview = await service.previewPublishedOfferImageRepairs({
      batchId,
      databaseContext: 'DEVELOPMENT_TEST',
      pgClient
    });

    expect(preview.totalPublishedOffers).toBe(12); // excludes 3 unpublished
    expect(preview.missingImageOffersCount).toBe(11); // excludes imaged Sunflower Oil!
    expect(preview.readyForRepairCount).toBe(0); // 011_t1..013_t1 are HELD pending sibling 10kg identity separation!
    expect(preview.awaitingIdentityCorrectionCount).toBe(6); // 3 Page 1 assortments + 3 Page 18 5kg tiers blocked on sibling 10kg unlink!
    expect(preview.awaitingCropCorrectionCount).toBe(1); // 010_t1 (dual-price card rejected!)
    expect(preview.requiresOperatorAttentionCount).toBe(4); // 010_t2 (no clean crop + 10kg fix) + 011/012/013_t2 (unconfirmed crop + 10kg fix)
    for (const num of ['011', '012', '013']) {
      const t1 = preview.repairs.find((r) => r.sourceOfferId === `leaflet-001_p018_${num}__tier_1`)!;
      expect(t1.repairEligibility).toBe('awaiting_identity_correction');
      expect(t1.dependsOnSiblingIdentityCorrection).toBe(true);
      expect(t1.blockingSiblingSourceOfferIds).toContain(`leaflet-001_p018_${num}__tier_2`);
    }

    const p010Preview = preview.repairs.find((r) => r.sourceOfferId === 'leaflet-001_p018_010__tier_1')!;
    expect(p010Preview.cropType).toBe('offer_card_unsuitable');
    expect(p010Preview.localSourceCropPath).toBeNull();
    expect(p010Preview.repairEligibility).toBe('awaiting_crop_correction');

    // B. Guarded check: zero authorizations rejects
    await expect(
      service.repairPublishedOfferImages({ batchId, operatorAuthorizedRepair: false, operatorAuthorizedIdentityCorrection: false })
    ).rejects.toThrow(/OPERATOR_AUTHORIZATION_REQUIRED/i);

    // C. Confirm Tier-2 crops for 011, 012, 013 (010 stays uncropped to test skip behavior)
    for (const num of ['011', '012', '013']) {
      await service.confirmDerivedTierCrop({
        batchId,
        batchOfferKey: `${batchId}:leaflet-001:18:leaflet-001_p018_${num}__tier_2`
      });
    }

    // D. Execute Controlled Repair with BOTH explicit authorizations
    const mockStorage = createInMemoryStorageAdapter('https://storage.mock.local');
    const repairRes = await service.repairPublishedOfferImages({
      batchId,
      operatorAuthorizedRepair: true,
      operatorAuthorizedIdentityCorrection: true,
      operatorId: 'vitest_operator',
      databaseContext: 'DEVELOPMENT_TEST',
      pgClient,
      storageAdapter: mockStorage
    });

    expect(repairRes.success).toBe(true);
    expect(repairRes.identityCorrectedCount).toBe(7); // 3 P1 assortments + 4 P18 10kg tiers!
    expect(repairRes.repairedCount).toBe(9); // 3 P1 assortments + 3 P18 5kg + 3 P18 confirmed 10kg!
    expect(repairRes.skippedCount).toBe(1); // 010_t1 skipped because only dual-price offer_card_crop existed!
    expect(repairRes.maintenanceOperationId).toBeTruthy();

    // Verify 4 new 10kg products were created (original 8 products + 4 new 10kg = 12 products total)
    const prodCountRes = await pgClient.query('SELECT count(*)::int AS cnt FROM public.products');
    expect(prodCountRes.rows[0].cnt).toBe(12);

    // Verify 5kg offers retained original product IDs, and 10kg offers relinked to distinct 10kg products
    const creamy5Db = await pgClient.query('SELECT product_id FROM public.offers WHERE id = $1', [creamy5Id]);
    const creamy10Db = await pgClient.query('SELECT product_id FROM public.offers WHERE id = $1', [creamy10Id]);
    expect(String(creamy5Db.rows[0].product_id)).toBe(creamyProdId);
    expect(String(creamy10Db.rows[0].product_id)).not.toBe(creamyProdId);
    const creamy10Prod = await pgClient.query('SELECT each_size_value::float8 FROM public.products WHERE id = $1', [creamy10Db.rows[0].product_id]);
    expect(Number(creamy10Prod.rows[0].each_size_value)).toBe(10);

    // Verify 3 Page 1 assortments converted cleanly, suppressed unit_price, preserved catalog products #24/#28/#29, and routed to offer_display_images
    for (const [id, preservedProdId] of [[waterOfferId, waterProdId], [luxOfferId, luxProdId], [omoOfferId, omoProdId]] as const) {
      const oRow = (await pgClient.query('SELECT * FROM public.offers WHERE id = $1', [id])).rows[0];
      expect(oRow.product_id).toBeNull();
      expect(oRow.assortment_status).toBe('multiple_variants');
      expect(oRow.title_en).toContain('— Assorted');
      expect(oRow.title_ar).toContain('— متنوع');
      expect(oRow.unit_price).toBeNull();
      expect(oRow.scoped_assessments.unit_price_comparison).toBe('blocked');
      expect(Array.isArray(oRow.known_options) && oRow.known_options.length).toBe(2);

      // Original catalog SKU still exists and has zero polluted product_images
      const pRow = (await pgClient.query('SELECT id FROM public.products WHERE id = $1', [Number(preservedProdId)])).rows;
      expect(pRow).toHaveLength(1);
      const piPolluted = (await pgClient.query('SELECT id FROM public.product_images WHERE product_id = $1', [Number(preservedProdId)])).rows;
      expect(piPolluted).toHaveLength(0);

      // Group image stored in offer_display_images and visible in v_consumer_offers
      const vRow = (await pgClient.query('SELECT image_url, display_image_kind FROM public.v_consumer_offers WHERE id = $1', [id])).rows[0];
      expect(vRow.image_url).toContain('/offer-display-images/');
      expect(vRow.display_image_kind).toBe('illustrative');
    }

    // Verify pre-existing imaged offer untouched
    const oilRow = (await pgClient.query('SELECT image_url FROM public.offers WHERE id = $1', [oilOfferId])).rows[0];
    expect(oilRow.image_url).toBe('https://storage/product-images/oil.webp');

    // Verify 3 unpublished offers completely preserved in staged-draft.json
    const savedDraft = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'staged-draft.json'), 'utf8'));
    const unpublished = savedDraft.items.filter((i: any) => !i.publicationState);
    expect(unpublished.map((u: any) => u.id)).toEqual([
      'leaflet-001_p001_012',
      'leaflet-001_p001_013',
      'leaflet-001_p018_007'
    ]);

    // Verify zero duplicate offers inserted
    const totalOffersDb = await pgClient.query('SELECT count(*)::int AS cnt FROM public.offers');
    expect(totalOffersDb.rows[0].cnt).toBe(12);

    // E. Idempotency retry: 011..013 + P1 skipped as already imaged, zero duplicate products/offers
    const retryRes = await service.repairPublishedOfferImages({
      batchId,
      operatorAuthorizedRepair: true,
      operatorAuthorizedIdentityCorrection: true,
      operatorId: 'vitest_operator',
      databaseContext: 'DEVELOPMENT_TEST',
      pgClient,
      storageAdapter: mockStorage
    });
    expect(retryRes.repairedCount).toBe(0);
    expect(retryRes.identityCorrectedCount).toBe(0);
    expect(retryRes.missingImageOffersCount).toBe(2); // only 010_t1 & 010_t2 remain unimaged!
    expect((await pgClient.query('SELECT count(*)::int AS cnt FROM public.products')).rows[0].cnt).toBe(12);
    expect((await pgClient.query('SELECT count(*)::int AS cnt FROM public.offers')).rows[0].cnt).toBe(12);
  });

  it('3. Migration 012 Consumer Image Precedence: handles offer_display, exact product, assorted NULL product, thumbnail_url-only hiding, tiers & 98-col grants', async () => {
    // 1. Check exact 98-column count & anon/authenticated SELECT grants on v_consumer_offers
    const colRes = await pgClient.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'v_consumer_offers'`
    );
    expect(colRes.rows[0].cnt).toBe(98);

    const privRes = await pgClient.query<{ anon_sel: boolean; auth_sel: boolean }>(
      `SELECT has_table_privilege('anon', 'public.v_consumer_offers', 'SELECT') AS anon_sel,
              has_table_privilege('authenticated', 'public.v_consumer_offers', 'SELECT') AS auth_sel`
    );
    expect(privRes.rows[0].anon_sel).toBe(true);
    expect(privRes.rows[0].auth_sel).toBe(true);

    // Seed shared 5kg product & 2 tiers + assortment + thumbnail-only offer
    const pRes5 = await pgClient.query(
      `INSERT INTO public.products (name_en, name_ar, brand_name, each_size_value, each_size_unit) VALUES ('Rice Shared 5kg', 'أرز 5 كجم', 'Al Bayt', 5, 'kg') RETURNING id`
    );
    const prod5Id = Number(pRes5.rows[0].id);
    const pRes10 = await pgClient.query(
      `INSERT INTO public.products (name_en, name_ar, brand_name, each_size_value, each_size_unit) VALUES ('Rice Separate 10kg', 'أرز 10 كجم', 'Al Bayt', 10, 'kg') RETURNING id`
    );
    const prod10Id = Number(pRes10.rows[0].id);

    const o5Res = await pgClient.query(
      `INSERT INTO public.offers (
        supermarket_id, product_id, title_en, title_ar, offer_start_date, offer_end_date,
        offer_price, status, location_scope, source_offer_id, catalog_match_status, each_size_value, each_size_unit
      ) VALUES ($1, $2, 'Rice Test 5kg', 'أرز', '2026-11-16', '2026-11-30', 39.95, 'published', 'national', 'src_mig012_5kg', 'verified_linked', 5, 'kg') RETURNING id`,
      [SUPERMARKET_ID, prod5Id]
    );
    const offer5Id = String(o5Res.rows[0].id);

    const o10SharedRes = await pgClient.query(
      `INSERT INTO public.offers (
        supermarket_id, product_id, title_en, title_ar, offer_start_date, offer_end_date,
        offer_price, status, location_scope, source_offer_id, catalog_match_status, each_size_value, each_size_unit
      ) VALUES ($1, $2, 'Rice Test 10kg', 'أرز 10', '2026-11-16', '2026-11-30', 66.95, 'published', 'national', 'src_mig012_10kg', 'verified_linked', 10, 'kg') RETURNING id`,
      [SUPERMARKET_ID, prod10Id]
    );
    const offer10Id = String(o10SharedRes.rows[0].id);

    const oAssortRes = await pgClient.query(
      `INSERT INTO public.offers (
        supermarket_id, product_id, title_en, title_ar, offer_start_date, offer_end_date,
        offer_price, status, location_scope, source_offer_id, catalog_match_status, assortment_status
      ) VALUES ($1, NULL, 'Sadia Assorted', 'ساديا متنوع', '2026-11-16', '2026-11-30', 19.99, 'published', 'national', 'src_mig012_assort', 'candidate_pending_review', 'multiple_variants') RETURNING id`,
      [SUPERMARKET_ID]
    );
    const offerAssortId = String(oAssortRes.rows[0].id);

    // Populated offers.thumbnail_url WITHOUT offer_display_images or product_images (Sadia-like stale state)
    const oThumbOnlyRes = await pgClient.query(
      `INSERT INTO public.offers (
        supermarket_id, product_id, title_en, title_ar, offer_start_date, offer_end_date,
        offer_price, status, location_scope, source_offer_id, catalog_match_status, assortment_status, thumbnail_url
      ) VALUES ($1, NULL, 'Thumb Only Offer', 'عرض مصغرة فقط', '2026-11-16', '2026-11-30', 19.99, 'published', 'national', 'src_mig012_thumbonly', 'candidate_pending_review', 'multiple_variants', 'https://cdn.wifran/product-images/stale-thumb-only.webp') RETURNING id`,
      [SUPERMARKET_ID]
    );
    const offerThumbOnlyId = String(oThumbOnlyRes.rows[0].id);

    // Insert reusable catalog image (product_images) for both 5kg & 10kg
    await pgClient.query(
      `INSERT INTO public.product_images (
        product_id, role, storage_bucket, storage_object_path, public_url,
        mime_type, byte_size, content_sha256, source_url, normalized_source_url,
        approval_status, rights_basis, reviewed_by
      ) VALUES
        ($1, 'primary', 'product-images', 'products/sha256/cat5.webp', 'https://cdn.wifran/product-images/cat5.webp', 'image/webp', 100, 'sha_cat5', 'https://cdn.wifran/product-images/cat5.webp', 'https://cdn.wifran/product-images/cat5.webp', 'approved', 'operator_manual_verified', 'op'),
        ($2, 'primary', 'product-images', 'products/sha256/cat10.webp', 'https://cdn.wifran/product-images/cat10.webp', 'image/webp', 100, 'sha_cat10', 'https://cdn.wifran/product-images/cat10.webp', 'https://cdn.wifran/product-images/cat10.webp', 'approved', 'operator_manual_verified', 'op')`,
      [prod5Id, prod10Id]
    );

    // Exact catalog product image check (when odi is absent)
    const viewExact5 = (await pgClient.query(`SELECT image_url, thumbnail_url, display_image_url, display_image_kind FROM public.v_consumer_offers WHERE id = $1`, [offer5Id])).rows[0];
    expect(viewExact5.image_url).toBe('https://cdn.wifran/product-images/cat5.webp');
    expect(viewExact5.display_image_kind).toBe('exact_product');

    // Thumbnail-only offer (no odi, product_id=NULL) MUST remain hidden (image_url = NULL) in v_consumer_offers
    const viewThumbOnly = (await pgClient.query(`SELECT product_id, image_url, thumbnail_url, display_image_url, display_image_kind FROM public.v_consumer_offers WHERE id = $1`, [offerThumbOnlyId])).rows[0];
    expect(viewThumbOnly.product_id).toBeNull();
    expect(viewThumbOnly.image_url).toBeNull();
    expect(viewThumbOnly.thumbnail_url).toBeNull();
    expect(viewThumbOnly.display_image_url).toBeNull();
    expect(viewThumbOnly.display_image_kind).toBeNull();

    // Insert UNAPPROVED (pending) offer_display_images on 10kg -> catalog 10kg image still takes precedence
    await pgClient.query(
      `INSERT INTO public.offer_display_images (
        offer_id, storage_bucket, storage_object_path, public_url,
        mime_type, byte_size, content_sha256, source_kind, visual_subject_key, approval_status
      ) VALUES ($1, 'offer-display-images', 'offers/pending.webp', 'https://cdn.wifran/offer-display-images/pending.webp', 'image/webp', 100, 'sha_pend', 'generated_illustration', 'k1', 'pending')`,
      [offer10Id]
    );
    const viewPending10 = (await pgClient.query(`SELECT image_url, display_image_kind FROM public.v_consumer_offers WHERE id = $1`, [offer10Id])).rows[0];
    expect(viewPending10.image_url).toBe('https://cdn.wifran/product-images/cat10.webp');
    expect(viewPending10.display_image_kind).toBe('exact_product');

    // Approve offer-specific images on 10kg tier AND Assorted offer (product_id = NULL)
    await pgClient.query(
      `INSERT INTO public.offer_display_images (
        offer_id, storage_bucket, storage_object_path, public_url,
        mime_type, byte_size, content_sha256, source_kind, visual_subject_key, approval_status
      ) VALUES
        ($1, 'offer-display-images', 'offers/approved10.webp', 'https://cdn.wifran/offer-display-images/approved10.webp', 'image/webp', 100, 'sha_app10', 'generated_illustration', 'k10', 'approved'),
        ($2, 'offer-display-images', 'offers/assort.webp', 'https://cdn.wifran/offer-display-images/assort.webp', 'image/webp', 100, 'sha_assort', 'generated_illustration', 'ka', 'approved')`,
      [offer10Id, offerAssortId]
    );
    const viewAfter10 = (await pgClient.query(`SELECT image_url, thumbnail_url, display_image_url, display_image_kind, card_image_subject_scope FROM public.v_consumer_offers WHERE id = $1`, [offer10Id])).rows[0];
    expect(viewAfter10.image_url).toBe('https://cdn.wifran/offer-display-images/approved10.webp');
    expect(viewAfter10.thumbnail_url).toBe('https://cdn.wifran/offer-display-images/approved10.webp');
    expect(viewAfter10.display_image_url).toBe('https://cdn.wifran/offer-display-images/approved10.webp');
    expect(viewAfter10.display_image_kind).toBe('illustrative');
    expect(viewAfter10.card_image_subject_scope).toBe('representative_assortment');

    // 5kg tier sharing/exact catalog image remains unaffected
    const view5After = (await pgClient.query(`SELECT image_url, display_image_kind FROM public.v_consumer_offers WHERE id = $1`, [offer5Id])).rows[0];
    expect(view5After.image_url).toBe('https://cdn.wifran/product-images/cat5.webp');
    expect(view5After.display_image_kind).toBe('exact_product');

    // Assorted offer with product_id = NULL serves its approved offer_display_images URL
    const viewAssortAfter = (await pgClient.query(`SELECT product_id, image_url, display_image_kind FROM public.v_consumer_offers WHERE id = $1`, [offerAssortId])).rows[0];
    expect(viewAssortAfter.product_id).toBeNull();
    expect(viewAssortAfter.image_url).toBe('https://cdn.wifran/offer-display-images/assort.webp');
    expect(viewAssortAfter.display_image_kind).toBe('illustrative');

    // Execute Migration 012 ROLLBACK SQL -> reverts to Migration 011 precedence (pi > odi) while keeping 98 columns & grants
    const rollbackSql = fs.readFileSync(
      path.resolve(process.cwd(), 'project-knowledge/wifran_docs/012_wifran_offer_display_image_precedence_rollback.sql'),
      'utf8'
    );
    await pgClient.query(rollbackSql);
    const viewRolledBack = (await pgClient.query(`SELECT image_url, display_image_kind FROM public.v_consumer_offers WHERE id = $1`, [offer10Id])).rows[0];
    expect(viewRolledBack.image_url).toBe('https://cdn.wifran/product-images/cat10.webp');
    expect(viewRolledBack.display_image_kind).toBe('exact_product');
    const colPostRollback = await pgClient.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'v_consumer_offers'`
    );
    expect(colPostRollback.rows[0].cnt).toBe(98);
  });

  it('4. Partial failure triggers PostgreSQL ROLLBACK and compensating deletion of newly uploaded Storage blobs', async () => {
    const batchDir = path.join(batchesDir, batchId);
    fs.mkdirSync(batchDir, { recursive: true });
    const thumb = await createMinimalWebp(path.join(workspaceDir, 'crops/page_18/leaflet-001_p018_011__tier_1/product_thumb_crop.webp'), { r: 100, g: 150, b: 100 });

    const pRes = await pgClient.query(
      `INSERT INTO public.products (name_en, name_ar, brand_name, each_size_value, each_size_unit) VALUES ('Rice Rollback', 'أرز', 'Al Bayt', 5, 'kg') RETURNING id`
    );
    const prodId = String(pRes.rows[0].id);
    const oRes = await pgClient.query(
      `INSERT INTO public.offers (
        supermarket_id, product_id, title_en, title_ar, offer_start_date, offer_end_date,
        offer_price, status, location_scope, source_offer_id, each_size_value, each_size_unit
      ) VALUES ($1, $2::bigint, 'Rice Rollback', 'أرز', '2026-11-16', '2026-11-30', 39.95, 'published', 'national', 'src_rb_1', 5, 'kg') RETURNING id`,
      [SUPERMARKET_ID, Number(prodId)]
    );
    const offerId = String(oRes.rows[0].id);

    fs.writeFileSync(
      path.join(workspaceDir, 'staged-draft.json'),
      JSON.stringify({
        leafletId: 'leaflet-001',
        items: [{
          id: 'leaflet-001_p018_011__tier_1',
          sourceOfferId: 'leaflet-001_p018_011__tier_1',
          pageNumber: 18,
          titleEn: 'Rice Rollback',
          each_size_value: 5,
          each_size_unit: 'kg',
          productThumbLocalPath: thumb,
          publicationState: { state: 'published', offerId, productId: prodId }
        }]
      }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(batchDir, 'batch-manifest.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        batchId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'partially_published',
        workspaceDir: batchesDir,
        model: 'gemini-2.5-flash',
        totals: { totalPdfs: 1, completedPdfs: 1, failedPdfs: 0, cancelledPdfs: 0, totalPages: 1, pagesProcessed: 1, totalOffers: 1, totalCostUsd: 0 },
        leaflets: [{
          leafletId: 'leaflet-001',
          fileName: 'alnokhbah.pdf',
          filePath: 'a.pdf',
          fileSizeBytes: 10,
          fileFingerprint: 'fp',
          workspacePath: workspaceDir,
          status: 'completed',
          pageCount: 1,
          pagesProcessed: 1,
          offersCount: 1,
          estimatedCostUsd: 0,
          provenance: 'fresh',
          metadata: {}
        }]
      }),
      'utf8'
    );

    const mockStorage = createInMemoryStorageAdapter('https://storage.mock.local');

    // Fault-injecting pgClient wrapper that throws on INSERT INTO public.product_images
    const faultClient: SqlQueryable = {
      query: async (sql: string, params?: any[]) => {
        if (sql.includes('INSERT INTO public.product_images')) {
          throw new Error('INJECTED_DB_FAILURE_MID_TRANSACTION');
        }
        return pgClient.query(sql, params);
      }
    };

    const service = new BatchOrchestrationService(batchesDir);
    await expect(
      service.repairPublishedOfferImages({
        batchId,
        operatorAuthorizedRepair: true,
        operatorAuthorizedIdentityCorrection: true,
        pgClient: faultClient,
        storageAdapter: mockStorage
      })
    ).rejects.toThrow(/INJECTED_DB_FAILURE_MID_TRANSACTION/);

    // Verify DB rolled back (offers.image_url is still NULL!) and Storage exclusive blob was cleaned up!
    const dbCheck = (await pgClient.query('SELECT image_url FROM public.offers WHERE id = $1', [offerId])).rows[0];
    expect(dbCheck.image_url).toBeNull();
    expect(mockStorage.storedObjects.size).toBe(0);
  });

  it('5. Deterministic rice-tier crop generator creates price-free crops locally, preserves offer_card_crop, and flags Tier 2 for confirmation', async () => {
    const pagesDir = path.join(workspaceDir, 'pages');
    const v3Dir = path.join(workspaceDir, 'hybrid_v3_results');
    const cardDirT1 = path.join(workspaceDir, 'crops/page_18/leaflet-001_p018_011__tier_1');
    fs.mkdirSync(pagesDir, { recursive: true });
    fs.mkdirSync(v3Dir, { recursive: true });
    fs.mkdirSync(cardDirT1, { recursive: true });

    // Create synthetic 1000x1000 page image and existing offer_card_crop.webp
    await sharp({
      create: { width: 1000, height: 1000, channels: 3, background: { r: 245, g: 240, b: 230 } }
    })
      .png()
      .toFile(path.join(pagesDir, 'page.18.png'));
    const origCardPath = await createMinimalWebp(path.join(cardDirT1, 'offer_card_crop.webp'), { r: 20, g: 20, b: 20 });

    fs.writeFileSync(
      path.join(v3Dir, 'page_18.v3.json'),
      JSON.stringify({
        pageResult: {
          componentBoxesBySourceOfferId: {
            'leaflet-001_p018_011': {
              product_graphic_box: [700, 150, 880, 310],
              promo_price_box: [840, 240, 895, 370]
            }
          }
        }
      }),
      'utf8'
    );

    const out = await generateDerivedTierProductCropsFromGeometry({
      workspacePath: workspaceDir,
      pageNumber: 18,
      targets: [
        { sourceOfferId: 'leaflet-001_p018_011__tier_1', parentCardId: 'leaflet-001_p018_011', tierIndex: 1 },
        { sourceOfferId: 'leaflet-001_p018_011__tier_2', parentCardId: 'leaflet-001_p018_011', tierIndex: 2 }
      ]
    });

    expect(out).toHaveLength(2);
    expect(out[0].priceBoxTrimmed).toBe(true);
    expect(out[0].sizeConfirmationStatus).toBe('exact_tier_graphic');
    expect(out[1].sizeConfirmationStatus).toBe('shared_single_graphic_requires_confirmation');
    expect(fs.existsSync(out[0].outputPath)).toBe(true);
    expect(fs.existsSync(out[1].outputPath)).toBe(true);
    // Original offer_card_crop preserved intact
    expect(fs.existsSync(origCardPath)).toBe(true);
  });

  it('6. Detects populated offers.thumbnail_url missing v_consumer_offers image (Sadia case), safely associates public assets to offer_display_images, and blocks private offer-images URLs', async () => {
    const batchDir = path.join(batchesDir, batchId);
    fs.mkdirSync(batchDir, { recursive: true });
    const mockStorage = createInMemoryStorageAdapter('https://storage.mock.local');

    // Offer A: Valid public URL in offers.thumbnail_url, product_id=NULL, NO offer_display_images row, no different local crop
    const validPublicUrl = 'https://storage.mock.local/offer-display-images/offers/sha256/aa/' + 'a'.repeat(64) + '.webp';
    const oValidRes = await pgClient.query(
      `INSERT INTO public.offers (
        supermarket_id, product_id, title_en, title_ar, offer_start_date, offer_end_date,
        offer_price, status, location_scope, source_offer_id, source_item_number,
        catalog_match_status, assortment_status, thumbnail_url
      ) VALUES ($1, NULL, 'Public Asset Assortment', 'متنوع عام', '2026-11-16', '2026-11-30', 15.0, 'published', 'national', 'doc:p001:valid_pub', 'leaflet-001_p001_009a', 'candidate_pending_review', 'multiple_variants', $2) RETURNING id`,
      [SUPERMARKET_ID, validPublicUrl]
    );
    const oValidId = String(oValidRes.rows[0].id);

    // Offer B: Private evidence offer-images URL in offers.thumbnail_url -> MUST be rejected cleanly!
    const privateUrl = 'https://storage.mock.local/offer-images/offers/private_card.webp';
    const oPrivRes = await pgClient.query(
      `INSERT INTO public.offers (
        supermarket_id, product_id, title_en, title_ar, offer_start_date, offer_end_date,
        offer_price, status, location_scope, source_offer_id, source_item_number,
        catalog_match_status, assortment_status, thumbnail_url
      ) VALUES ($1, NULL, 'Private Url Assortment', 'عرض خاص', '2026-11-16', '2026-11-30', 12.0, 'published', 'national', 'doc:p001:priv', 'leaflet-001_p001_009b', 'candidate_pending_review', 'multiple_variants', $2) RETURNING id`,
      [SUPERMARKET_ID, privateUrl]
    );
    const oPrivId = String(oPrivRes.rows[0].id);

    // Offer C: Sadia p001_009 — older price-polluted URL in product-images vs cleaner regenerated local product_thumb_crop.webp
    const sadiaStaleUrl = 'https://storage.mock.local/product-images/products/sha256/bb/' + 'b'.repeat(64) + '.webp';
    const sadiaCleanThumb = await createMinimalWebp(
      path.join(workspaceDir, 'crops/page_1/leaflet-001_p001_009/product_thumb_crop.webp'),
      { r: 230, g: 200, b: 60 }
    );
    const oSadiaRes = await pgClient.query(
      `INSERT INTO public.offers (
        supermarket_id, product_id, title_en, title_ar, offer_start_date, offer_end_date,
        offer_price, status, location_scope, source_offer_id, source_item_number,
        catalog_match_status, assortment_status, image_subject_scope, thumbnail_url
      ) VALUES ($1, NULL, 'Sadia Broasted Chicken 700g / 750g — Assorted', 'ساديا دجاج بروستد', '2026-11-16', '2026-11-30', 19.99, 'published', 'national', 'doc:p001:sadia', 'leaflet-001_p001_009', 'candidate_pending_review', 'multiple_variants', 'product_package', $2) RETURNING id`,
      [SUPERMARKET_ID, sadiaStaleUrl]
    );
    const oSadiaId = String(oSadiaRes.rows[0].id);

    // Verify all 3 have NULL in v_consumer_offers BEFORE repair despite populated offers.thumbnail_url!
    const preVco = await pgClient.query(
      `SELECT id::text, image_url FROM public.v_consumer_offers WHERE id = ANY($1::uuid[])`,
      [[oValidId, oPrivId, oSadiaId]]
    );
    expect(preVco.rows.every((r: any) => r.image_url === null)).toBe(true);

    fs.writeFileSync(
      path.join(workspaceDir, 'staged-draft.json'),
      JSON.stringify({
        leafletId: 'leaflet-001',
        items: [
          {
            id: 'leaflet-001_p001_009a',
            sourceOfferId: 'leaflet-001_p001_009a',
            pageNumber: 1,
            titleEn: 'Public Asset Assortment',
            assortment_status: 'unsplit_assortment',
            publicationState: { state: 'published', offerId: oValidId, productId: null, imageUrl: validPublicUrl }
          },
          {
            id: 'leaflet-001_p001_009b',
            sourceOfferId: 'leaflet-001_p001_009b',
            pageNumber: 1,
            titleEn: 'Private Url Assortment',
            assortment_status: 'unsplit_assortment',
            publicationState: { state: 'published', offerId: oPrivId, productId: null, imageUrl: privateUrl }
          },
          {
            id: 'leaflet-001_p001_009',
            sourceOfferId: 'leaflet-001_p001_009',
            pageNumber: 1,
            titleEn: 'Sadia Broasted Chicken 700g / 750g — Assorted',
            assortment_status: 'unsplit_assortment',
            productThumbLocalPath: sadiaCleanThumb,
            publicationState: { state: 'published', offerId: oSadiaId, productId: null }
          }
        ]
      }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(batchDir, 'batch-manifest.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        batchId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'partially_published',
        workspaceDir: batchesDir,
        model: 'gemini-2.5-flash',
        totals: { totalPdfs: 1, completedPdfs: 1, failedPdfs: 0, cancelledPdfs: 0, totalPages: 1, pagesProcessed: 1, totalOffers: 3, totalCostUsd: 0 },
        leaflets: [{
          leafletId: 'leaflet-001',
          fileName: 'alnokhbah.pdf',
          filePath: 'a.pdf',
          fileSizeBytes: 10,
          fileFingerprint: 'fp',
          workspacePath: workspaceDir,
          status: 'completed',
          pageCount: 1,
          pagesProcessed: 1,
          offersCount: 3,
          estimatedCostUsd: 0,
          provenance: 'fresh',
          metadata: { supermarketId: SUPERMARKET_ID, supermarketName: 'Al Nokhbah Markets', offerStartDate: '2026-11-16', offerEndDate: '2026-11-30' }
        }]
      }),
      'utf8'
    );

    const service = new BatchOrchestrationService(batchesDir);
    const preview = await service.previewPublishedOfferImageRepairs({
      batchId,
      databaseContext: 'DEVELOPMENT_TEST',
      pgClient
    });

    expect(preview.totalPublishedOffers).toBe(3);
    expect(preview.missingImageOffersCount).toBe(3); // Even though all 3 had offers.thumbnail_url populated!
    expect(preview.missingOdiAssociationCount).toBe(3);
    expect(preview.readyForRepairCount).toBe(2); // Offer A (valid public ODI assoc) + Offer C (Sadia clean local crop)
    expect(preview.awaitingCropCorrectionCount).toBe(1); // Offer B (private evidence URL rejected!)

    const itemValid = preview.repairs.find((r) => r.sourceOfferId === 'leaflet-001_p001_009a')!;
    expect(itemValid.repairActionKind).toBe('associate_existing_public_asset_to_odi');
    expect(itemValid.hasPopulatedOfferThumbnailWithoutConsumerRow).toBe(true);

    const itemPriv = preview.repairs.find((r) => r.sourceOfferId === 'leaflet-001_p001_009b')!;
    expect(itemPriv.repairActionKind).toBe('blocked_private_or_unsuitable_asset');
    expect(itemPriv.repairEligibility).toBe('awaiting_crop_correction');

    const itemSadia = preview.repairs.find((r) => r.sourceOfferId === 'leaflet-001_p001_009')!;
    expect(itemSadia.repairEligibility).toBe('ready_for_repair');
    expect(itemSadia.targetBucket).toBe('offer-display-images');
    expect(itemSadia.hasPopulatedOfferThumbnailWithoutConsumerRow).toBe(true);

    // Execute repair -> Offer A gets ODI row idempotently, Offer C gets clean Sadia offer-display-images row + scope, Offer B is skipped
    const execRes = await service.repairPublishedOfferImages({
      batchId,
      operatorAuthorizedRepair: true,
      operatorAuthorizedIdentityCorrection: false,
      databaseContext: 'DEVELOPMENT_TEST',
      pgClient,
      storageAdapter: mockStorage
    });
    expect(execRes.repairedCount).toBe(2);
    expect(execRes.skippedCount).toBe(1);

    const vcoAfter = await pgClient.query(
      `SELECT id::text, source_offer_id, product_id, image_url, display_image_kind FROM public.v_consumer_offers ORDER BY source_offer_id`
    );
    const byIdAfter = Object.fromEntries(vcoAfter.rows.map((r: any) => [r.id, r]));
    expect(byIdAfter[oValidId].image_url).toBe(validPublicUrl);
    expect(byIdAfter[oValidId].display_image_kind).toBe('illustrative');
    expect(byIdAfter[oPrivId].image_url).toBeNull(); // Private evidence URL NEVER exposed!
    expect(byIdAfter[oSadiaId].image_url).toContain('/offer-display-images/');
    expect(byIdAfter[oSadiaId].product_id).toBeNull();
    expect(byIdAfter[oSadiaId].source_offer_id).toBe('doc:p001:sadia'); // Source identity unchanged!
    const sadiaOfferDb = (await pgClient.query(`SELECT image_subject_scope FROM public.offers WHERE id = $1`, [oSadiaId])).rows[0];
    expect(sadiaOfferDb.image_subject_scope).toBe('representative_assortment');

    // Retry repair is strictly idempotent (zero duplicate offers or duplicate ODI rows)
    const retryRes = await service.repairPublishedOfferImages({
      batchId,
      operatorAuthorizedRepair: true,
      operatorAuthorizedIdentityCorrection: false,
      databaseContext: 'DEVELOPMENT_TEST',
      pgClient,
      storageAdapter: mockStorage
    });
    expect(retryRes.repairedCount).toBe(0);
    expect((await pgClient.query('SELECT count(*)::int AS cnt FROM public.offers')).rows[0].cnt).toBe(3);
  });

  it('7. Tightened 10kg crop confirmation blocks 5KG-labeled packages and requires replacement photo', async () => {
    const batchDir = path.join(batchesDir, batchId);
    fs.mkdirSync(batchDir, { recursive: true });
    const mockStorage = createInMemoryStorageAdapter('https://storage.mock.local');

    const bag5kgCrop = await createMinimalWebp(
      path.join(workspaceDir, 'crops/page_18/leaflet-001_p018_011__tier_2/product_thumb_crop.webp'),
      { r: 190, g: 160, b: 120 }
    );
    fs.writeFileSync(
      path.join(path.dirname(bag5kgCrop), 'derived_tier_crop_meta.json'),
      JSON.stringify({
        sourceOfferId: 'leaflet-001_p018_011__tier_2',
        parentCardId: 'leaflet-001_p018_011',
        tierIndex: 2,
        sizeConfirmationStatus: 'shared_single_graphic_requires_confirmation',
        visiblePackageWeightLabel: '5KG',
        visiblePackageSizeConflict: true,
        allowOperatorConfirmation: false,
        requiresReplacementImage: true,
        confirmationBlockedReason: 'Flyer bag physically prints Net weight 5KG; cannot confirm for 10 kg offer.',
        operatorConfirmed: false
      }, null, 2),
      'utf8'
    );

    const p5Res = await pgClient.query(
      `INSERT INTO public.products (name_en, name_ar, brand_name, each_size_value, each_size_unit) VALUES ('Creamy Sella', 'أرز سيلا', 'Al Bayt', 5, 'kg') RETURNING id`
    );
    const prod5Id = String(p5Res.rows[0].id);
    const o10Res = await pgClient.query(
      `INSERT INTO public.offers (
        supermarket_id, product_id, title_en, title_ar, offer_start_date, offer_end_date,
        offer_price, status, location_scope, source_offer_id, catalog_match_status, each_size_value, each_size_unit
      ) VALUES ($1, $2::bigint, 'Creamy Sella', 'أرز سيلا', '2026-11-16', '2026-11-30', 66.95, 'published', 'national', 'doc:p018:011_t2', 'candidate_pending_review', 10, 'kg') RETURNING id`,
      [SUPERMARKET_ID, Number(prod5Id)]
    );
    const o10Id = String(o10Res.rows[0].id);

    const batchOfferKey = `${batchId}:leaflet-001:18:leaflet-001_p018_011__tier_2`;
    fs.writeFileSync(
      path.join(workspaceDir, 'staged-draft.json'),
      JSON.stringify({
        leafletId: 'leaflet-001',
        items: [{
          id: 'leaflet-001_p018_011__tier_2',
          sourceOfferId: 'leaflet-001_p018_011__tier_2',
          pageNumber: 18,
          titleEn: 'Creamy Sella',
          titleAr: 'أرز سيلا',
          brandEn: 'Al Bayt',
          each_size_value: 10,
          each_size_unit: 'kg',
          productThumbLocalPath: bag5kgCrop,
          publicationState: { state: 'published', offerId: o10Id, productId: prod5Id }
        }]
      }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(batchDir, 'batch-manifest.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        batchId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'partially_published',
        workspaceDir: batchesDir,
        model: 'gemini-2.5-flash',
        totals: { totalPdfs: 1, completedPdfs: 1, failedPdfs: 0, cancelledPdfs: 0, totalPages: 1, pagesProcessed: 1, totalOffers: 1, totalCostUsd: 0 },
        leaflets: [{
          leafletId: 'leaflet-001',
          fileName: 'alnokhbah.pdf',
          filePath: 'a.pdf',
          fileSizeBytes: 10,
          fileFingerprint: 'fp',
          workspacePath: workspaceDir,
          status: 'completed',
          pageCount: 1,
          pagesProcessed: 1,
          offersCount: 1,
          estimatedCostUsd: 0,
          provenance: 'fresh',
          metadata: { supermarketId: SUPERMARKET_ID, supermarketName: 'Al Nokhbah Markets', offerStartDate: '2026-11-16', offerEndDate: '2026-11-30' }
        }]
      }),
      'utf8'
    );

    const service = new BatchOrchestrationService(batchesDir);

    // 1. Attempting confirmDerivedTierCrop MUST throw fail-closed for 5KG-labeled 10kg offer
    await expect(service.confirmDerivedTierCrop({ batchId, batchOfferKey })).rejects.toThrow(
      /INCONSISTENT_PACKAGE_SIZE_CONFIRMATION_BLOCKED|5KG/i
    );

    // 2. Preview shows canConfirmCrop=false & requiresReplacementImage=true
    const preview = await service.previewPublishedOfferImageRepairs({
      batchId,
      confirmedCropOfferKeys: [batchOfferKey],
      databaseContext: 'DEVELOPMENT_TEST',
      pgClient
    });
    expect(preview.repairs[0].canConfirmCrop).toBe(false);
    expect(preview.repairs[0].requiresReplacementImage).toBe(true);
    expect(preview.repairs[0].visiblePackageWeightLabel).toBe('5KG');
    expect(preview.repairs[0].cropConfirmed).toBe(false);

    // 3. Even if caller passes confirmedCropOfferKeys + both authorizations, 5KG bag is NEVER uploaded for 10kg offer!
    const repairHold = await service.repairPublishedOfferImages({
      batchId,
      operatorAuthorizedRepair: true,
      operatorAuthorizedIdentityCorrection: true,
      confirmedCropOfferKeys: [batchOfferKey],
      databaseContext: 'DEVELOPMENT_TEST',
      pgClient,
      storageAdapter: mockStorage
    });
    expect(repairHold.identityCorrectedCount).toBe(1); // Relinks to new 10kg candidate product
    expect(repairHold.repairedCount).toBe(0); // 5KG bag image HELD!
    expect(repairHold.repairs[0].status).toBe('identity_corrected_only');

    // 4. Operator supplies verified 10kg replacement image -> now ready and repairs cleanly!
    const replacement10kgPath = await createMinimalWebp(
      path.join(workspaceDir, 'crops/custom/10kg_bag_photo.webp'),
      { r: 80, g: 180, b: 90 }
    );
    const updatedDraft = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'staged-draft.json'), 'utf8'));
    updatedDraft.items[0].customProductThumbCropPath = replacement10kgPath;
    fs.writeFileSync(path.join(workspaceDir, 'staged-draft.json'), JSON.stringify(updatedDraft, null, 2));

    const repairAfterCustom = await service.repairPublishedOfferImages({
      batchId,
      operatorAuthorizedRepair: true,
      operatorAuthorizedIdentityCorrection: true,
      databaseContext: 'DEVELOPMENT_TEST',
      pgClient,
      storageAdapter: mockStorage
    });
    expect(repairAfterCustom.repairedCount).toBe(1);
    const finalVco = (await pgClient.query(`SELECT image_url FROM public.v_consumer_offers WHERE id = $1`, [o10Id])).rows[0];
    expect(finalVco.image_url).toBeTruthy();
  });

  it('8. Shared 5kg/10kg critical dependency: holds 5kg catalog images on partial auth or selective target, rolls back atomically on partial failure, verifies Phase-1-before-Phase-2 ordering, and allows independent identity-only separation without 10kg images', async () => {
    const batchDir = path.join(batchesDir, batchId);
    fs.mkdirSync(batchDir, { recursive: true });
    const mockStorage = createInMemoryStorageAdapter('https://storage.mock.local');

    // Seed explicit Product IDs matching UAT (#19, #20, #21, #36 equivalent shared 5kg rice SKUs)
    const riceSpecs = [
      { id: 19, num: '011', nameEn: 'Creamy Sella Long Grain Basmati Rice', nameAr: 'أرز سيلا كريمي', brand: 'Al Bayt', has5kgBlocked10kg: true },
      { id: 20, num: '012', nameEn: 'XXL Golden Sella Long Grain Basmati Rice', nameAr: 'أرز ذهبي اكس اكس ال', brand: 'Al Bayt', has5kgBlocked10kg: true },
      { id: 21, num: '013', nameEn: 'Golden Sella Long Grain Basmati Rice', nameAr: 'أرز ذهبي سيلا', brand: 'Al Bayt', has5kgBlocked10kg: true },
      { id: 36, num: '010', nameEn: 'Rice Long Grain White Basmathi', nameAr: 'الوليمة أرز بسمتي أبيض', brand: 'Al Walimah', has5kgBlocked10kg: false }
    ] as const;

    const draftItems: any[] = [];
    const offer5Ids: string[] = [];
    const offer10Ids: string[] = [];

    for (const r of riceSpecs) {
      await pgClient.query(
        `INSERT INTO public.products (id, name_en, name_ar, brand_name, each_size_value, each_size_unit)
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3, $4, 5, 'kg')`,
        [r.id, r.nameEn, r.nameAr, r.brand]
      );

      const o5 = await pgClient.query(
        `INSERT INTO public.offers (
          supermarket_id, product_id, title_en, title_ar, offer_start_date, offer_end_date,
          offer_price, status, location_scope, source_offer_id, catalog_match_status, each_size_value, each_size_unit
        ) VALUES ($1, $2, $3, $4, '2026-11-16', '2026-11-30', 39.95, 'published', 'national', $5, 'verified_linked', 5, 'kg') RETURNING id`,
        [SUPERMARKET_ID, r.id, r.nameEn, r.nameAr, `doc:p018:${r.num}_t1`]
      );
      const o10 = await pgClient.query(
        `INSERT INTO public.offers (
          supermarket_id, product_id, title_en, title_ar, offer_start_date, offer_end_date,
          offer_price, status, location_scope, source_offer_id, catalog_match_status, each_size_value, each_size_unit
        ) VALUES ($1, $2, $3, $4, '2026-11-16', '2026-11-30', 66.95, 'published', 'national', $5, 'unresolved', 10, 'kg') RETURNING id`,
        [SUPERMARKET_ID, r.id, r.nameEn, r.nameAr, `doc:p018:${r.num}_t2`]
      );
      const id5 = String(o5.rows[0].id);
      const id10 = String(o10.rows[0].id);
      offer5Ids.push(id5);
      offer10Ids.push(id10);

      const thumb5 = await createMinimalWebp(
        path.join(workspaceDir, `crops/page_18/leaflet-001_p018_${r.num}__tier_1/product_thumb_crop.webp`),
        { r: 100 + Number(r.num), g: 160, b: 90 }
      );
      const thumb10 = await createMinimalWebp(
        path.join(workspaceDir, `crops/page_18/leaflet-001_p018_${r.num}__tier_2/product_thumb_crop.webp`),
        { r: 190, g: 150, b: 110 }
      );
      fs.writeFileSync(
        path.join(path.dirname(thumb10), 'derived_tier_crop_meta.json'),
        JSON.stringify({
          sourceOfferId: `leaflet-001_p018_${r.num}__tier_2`,
          parentCardId: `leaflet-001_p018_${r.num}`,
          tierIndex: 2,
          sizeConfirmationStatus: 'shared_single_graphic_requires_confirmation',
          visiblePackageWeightLabel: r.has5kgBlocked10kg ? '5KG' : null,
          visiblePackageSizeConflict: r.has5kgBlocked10kg,
          allowOperatorConfirmation: !r.has5kgBlocked10kg,
          requiresReplacementImage: r.has5kgBlocked10kg,
          operatorConfirmed: false
        }),
        'utf8'
      );

      // Put 5kg item BEFORE 10kg item in staged-draft order to prove loop order cannot leak 5kg product_images!
      draftItems.push({
        id: `leaflet-001_p018_${r.num}__tier_1`,
        sourceOfferId: `leaflet-001_p018_${r.num}__tier_1`,
        pageNumber: 18,
        titleEn: r.nameEn,
        titleAr: r.nameAr,
        brandEn: r.brand,
        each_size_value: 5,
        each_size_unit: 'kg',
        productThumbLocalPath: thumb5,
        publicationState: { state: 'published', offerId: id5, productId: String(r.id) }
      });
      draftItems.push({
        id: `leaflet-001_p018_${r.num}__tier_2`,
        sourceOfferId: `leaflet-001_p018_${r.num}__tier_2`,
        pageNumber: 18,
        titleEn: r.nameEn,
        titleAr: r.nameAr,
        brandEn: r.brand,
        each_size_value: 10,
        each_size_unit: 'kg',
        productThumbLocalPath: thumb10,
        publicationState: { state: 'published', offerId: id10, productId: String(r.id) }
      });
    }
    await pgClient.query(`SELECT setval(pg_get_serial_sequence('public.products', 'id'), 100, true)`);

    // Add independent Sadia p001_009 assortment (product_id = NULL -> offer-display-images)
    const sadiaThumb = await createMinimalWebp(
      path.join(workspaceDir, 'crops/page_1/leaflet-001_p001_009/product_thumb_crop.webp'),
      { r: 220, g: 190, b: 70 }
    );
    const sadiaRes = await pgClient.query(
      `INSERT INTO public.offers (
        supermarket_id, product_id, title_en, title_ar, offer_start_date, offer_end_date,
        offer_price, status, location_scope, source_offer_id, catalog_match_status, assortment_status
      ) VALUES ($1, NULL, 'Sadia Broasted Chicken — Assorted', 'ساديا', '2026-11-16', '2026-11-30', 19.99, 'published', 'national', 'doc:p001:009', 'candidate_pending_review', 'multiple_variants') RETURNING id`,
      [SUPERMARKET_ID]
    );
    const sadiaId = String(sadiaRes.rows[0].id);
    draftItems.unshift({
      id: 'leaflet-001_p001_009',
      sourceOfferId: 'leaflet-001_p001_009',
      pageNumber: 1,
      titleEn: 'Sadia Broasted Chicken — Assorted',
      assortment_status: 'unsplit_assortment',
      imageSubjectScope: 'representative_assortment',
      productThumbLocalPath: sadiaThumb,
      publicationState: { state: 'published', offerId: sadiaId, productId: null }
    });

    const resetFixtureFiles = () => {
      fs.writeFileSync(
        path.join(workspaceDir, 'staged-draft.json'),
        JSON.stringify({ leafletId: 'leaflet-001', items: JSON.parse(JSON.stringify(draftItems)) }, null, 2),
        'utf8'
      );
      fs.writeFileSync(
        path.join(batchDir, 'batch-manifest.json'),
        JSON.stringify({
          schemaVersion: '1.0',
          batchId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'partially_published',
          workspaceDir: batchesDir,
          model: 'gemini-2.5-flash',
          totals: { totalPdfs: 1, completedPdfs: 1, failedPdfs: 0, cancelledPdfs: 0, totalPages: 2, pagesProcessed: 2, totalOffers: 9, totalCostUsd: 0 },
          leaflets: [{
            leafletId: 'leaflet-001',
            fileName: 'alnokhbah.pdf',
            filePath: 'a.pdf',
            fileSizeBytes: 10,
            fileFingerprint: 'fp',
            workspacePath: workspaceDir,
            status: 'completed',
            pageCount: 2,
            pagesProcessed: 2,
            offersCount: 9,
            estimatedCostUsd: 0,
            provenance: 'fresh',
            metadata: { supermarketId: SUPERMARKET_ID, supermarketName: 'Al Nokhbah Markets', offerStartDate: '2026-11-16', offerEndDate: '2026-11-30' }
          }]
        }),
        'utf8'
      );
    };
    resetFixtureFiles();

    const service = new BatchOrchestrationService(batchesDir);

    // 1. Preview MUST hold all four 5kg catalog offers behind sibling 10kg identity separation!
    const prePreview = await service.previewPublishedOfferImageRepairs({
      batchId,
      databaseContext: 'DEVELOPMENT_TEST',
      pgClient
    });
    expect(prePreview.totalPublishedOffers).toBe(9);
    expect(prePreview.readyForRepairCount).toBe(1); // ONLY Sadia!
    expect(prePreview.awaitingIdentityCorrectionCount).toBe(4); // All 4 5kg rice tiers held behind sibling 10kg separation!
    expect(prePreview.requiresOperatorAttentionCount).toBe(4); // All 4 10kg tiers

    // 2. Partial Authorization (Images ONLY, authIdentity = false):
    // Sadia repairs safely to offer-display-images, while ALL 4 5kg catalog updates are HELD (zero product_images or 5kg ODI)!
    const partialAuthRes = await service.repairPublishedOfferImages({
      batchId,
      operatorAuthorizedRepair: true,
      operatorAuthorizedIdentityCorrection: false,
      databaseContext: 'DEVELOPMENT_TEST',
      pgClient,
      storageAdapter: mockStorage
    });
    expect(partialAuthRes.repairedCount).toBe(1); // Sadia only!
    expect(partialAuthRes.identityCorrectedCount).toBe(0);
    for (const r of riceSpecs) {
      const item5 = partialAuthRes.repairs.find((x) => x.sourceOfferId === `leaflet-001_p018_${r.num}__tier_1`)!;
      expect(item5.status).toBe('skipped_shared_product_identity_pending');
    }
    expect((await pgClient.query(`SELECT count(*)::int AS cnt FROM public.product_images`)).rows[0].cnt).toBe(0);
    const vcoAfterPartial = await pgClient.query(
      `SELECT id::text, image_url FROM public.v_consumer_offers WHERE id = ANY($1::uuid[])`,
      [[...offer5Ids, ...offer10Ids]]
    );
    expect(vcoAfterPartial.rows.every((row: any) => row.image_url === null)).toBe(true);

    // 3. Selective partial targeting ONLY the 4 5kg offers even WITH dual authorization -> STILL HELD fail-closed!
    const only5kgKeys = riceSpecs.map((r) => `${batchId}:leaflet-001:18:leaflet-001_p018_${r.num}__tier_1`);
    const selectiveRes = await service.repairPublishedOfferImages({
      batchId,
      operatorAuthorizedRepair: true,
      operatorAuthorizedIdentityCorrection: true,
      targetBatchOfferKeys: only5kgKeys,
      databaseContext: 'DEVELOPMENT_TEST',
      pgClient,
      storageAdapter: mockStorage
    });
    expect(selectiveRes.repairedCount).toBe(0);
    expect((await pgClient.query(`SELECT count(*)::int AS cnt FROM public.product_images`)).rows[0].cnt).toBe(0);
    const vcoAfterSelective = await pgClient.query(
      `SELECT id::text, image_url FROM public.v_consumer_offers WHERE id = ANY($1::uuid[])`,
      [offer10Ids]
    );
    expect(vcoAfterSelective.rows.every((row: any) => row.image_url === null)).toBe(true);

    // 4a. Fault injection mid-Phase-1 (fail on 3rd 10kg offer relink) -> ROLLBACK, 0 storage objects added, 0 10kg leakage!
    const preBlobCount = mockStorage.storedObjects.size;
    let relinkUpdateCount = 0;
    const phase1FaultClient: SqlQueryable = {
      query: async (sql: string, params?: any[]) => {
        if (sql.includes('UPDATE public.offers') && sql.includes('SET product_id = $2::bigint')) {
          relinkUpdateCount++;
          if (relinkUpdateCount === 3) throw new Error('INJECTED_PHASE1_PARTIAL_RELINK_FAILURE');
        }
        return pgClient.query(sql, params);
      }
    };
    await expect(
      service.repairPublishedOfferImages({
        batchId,
        operatorAuthorizedRepair: true,
        operatorAuthorizedIdentityCorrection: true,
        databaseContext: 'DEVELOPMENT_TEST',
        pgClient: phase1FaultClient,
        storageAdapter: mockStorage
      })
    ).rejects.toThrow(/INJECTED_PHASE1_PARTIAL_RELINK_FAILURE/);
    expect(mockStorage.storedObjects.size).toBe(preBlobCount); // Storage untouched because Phase 2 never ran!
    expect((await pgClient.query(`SELECT count(*)::int AS cnt FROM public.product_images`)).rows[0].cnt).toBe(0);
    // All 4 10kg offers still cleanly rolled back to initial state with NULL consumer image
    const offersAfterP1Fail = await pgClient.query(
      `SELECT id::text, product_id FROM public.offers WHERE id = ANY($1::uuid[])`,
      [offer10Ids]
    );
    expect(offersAfterP1Fail.rows.map((r: any) => Number(r.product_id)).sort((a: number, b: number) => a - b)).toEqual([19, 20, 21, 36]);
    const vcoAfterP1Fail = await pgClient.query(
      `SELECT id::text, image_url FROM public.v_consumer_offers WHERE id = ANY($1::uuid[])`,
      [offer10Ids]
    );
    expect(vcoAfterP1Fail.rows.every((row: any) => row.image_url === null)).toBe(true);

    // 4b. Simulated incomplete relink caught by Post-Phase-1 Verification Gate -> SHARED_PRODUCT_CONTAMINATION_BLOCKED!
    const sneakyNoOpRelinkClient: SqlQueryable = {
      query: async <T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> => {
        if (
          sql.includes('UPDATE public.offers') &&
          sql.includes('SET product_id = $2::bigint') &&
          params?.[0] === offer10Ids[1] // Skip relinking #20's 10kg offer while claiming success!
        ) {
          return { rows: [{ id: offer10Ids[1], product_id: 20 } as unknown as T] };
        }
        return pgClient.query<T>(sql, params);
      }
    };
    await expect(
      service.repairPublishedOfferImages({
        batchId,
        operatorAuthorizedRepair: true,
        operatorAuthorizedIdentityCorrection: true,
        databaseContext: 'DEVELOPMENT_TEST',
        pgClient: sneakyNoOpRelinkClient,
        storageAdapter: mockStorage
      })
    ).rejects.toThrow(/SHARED_PRODUCT_CONTAMINATION_BLOCKED/);
    expect(mockStorage.storedObjects.size).toBe(preBlobCount);
    expect((await pgClient.query(`SELECT count(*)::int AS cnt FROM public.product_images`)).rows[0].cnt).toBe(0);

    // 4c. Fault injection mid-Phase-2 (fail on 2nd INSERT INTO public.product_images) -> ROLLBACKs Phase 1 + Phase 2 & cleans storage!
    let piInsertCount = 0;
    const phase2FaultClient: SqlQueryable = {
      query: async (sql: string, params?: any[]) => {
        if (sql.includes('INSERT INTO public.product_images')) {
          piInsertCount++;
          if (piInsertCount === 2) throw new Error('INJECTED_PHASE2_PRODUCT_IMAGE_FAILURE');
        }
        return pgClient.query(sql, params);
      }
    };
    await expect(
      service.repairPublishedOfferImages({
        batchId,
        operatorAuthorizedRepair: true,
        operatorAuthorizedIdentityCorrection: true,
        databaseContext: 'DEVELOPMENT_TEST',
        pgClient: phase2FaultClient,
        storageAdapter: mockStorage
      })
    ).rejects.toThrow(/INJECTED_PHASE2_PRODUCT_IMAGE_FAILURE/);
    expect(mockStorage.storedObjects.size).toBe(preBlobCount); // Exclusive Phase-2 blobs deleted on rollback!
    expect((await pgClient.query(`SELECT count(*)::int AS cnt FROM public.product_images`)).rows[0].cnt).toBe(0);
    const vcoAfterP2Fail = await pgClient.query(
      `SELECT id::text, image_url FROM public.v_consumer_offers WHERE id = ANY($1::uuid[])`,
      [offer10Ids]
    );
    expect(vcoAfterP2Fail.rows.every((row: any) => row.image_url === null)).toBe(true);

    // 5. Dual-authorized run on full fixture -> prove strict SQL chronological order (ALL 4 relinks BEFORE ANY product_images write)
    const sqlTimeline: string[] = [];
    const spyingClient: SqlQueryable = {
      query: async (sql: string, params?: any[]) => {
        if (sql.includes('UPDATE public.offers') && sql.includes('SET product_id = $2::bigint')) {
          sqlTimeline.push(`PHASE1_RELINK:${params?.[0]}`);
        } else if (sql.includes('INSERT INTO public.product_images')) {
          sqlTimeline.push(`PHASE2_PI_INSERT:${params?.[0]}`);
        }
        return pgClient.query(sql, params);
      }
    };
    const dualRes = await service.repairPublishedOfferImages({
      batchId,
      operatorAuthorizedRepair: true,
      operatorAuthorizedIdentityCorrection: true,
      databaseContext: 'DEVELOPMENT_TEST',
      pgClient: spyingClient,
      storageAdapter: mockStorage
    });
    expect(dualRes.identityCorrectedCount).toBe(4);
    expect(dualRes.repairedCount).toBe(4); // 4 5kg catalog images repaired cleanly!

    const lastPhase1Idx = sqlTimeline.reduce((acc, s, i) => (s.startsWith('PHASE1_RELINK:') ? i : acc), -1);
    const firstPhase2Idx = sqlTimeline.findIndex((s) => s.startsWith('PHASE2_PI_INSERT:'));
    expect(lastPhase1Idx).toBe(3); // All 4 relinks finished
    expect(firstPhase2Idx).toBeGreaterThan(lastPhase1Idx); // Strictly after Phase 1!

    // Verify committed consumer views: 5kg has exact 5kg image; ALL 4 10kg offers have distinct 10kg products and NULL consumer image!
    const vco5Final = await pgClient.query(
      `SELECT id::text, product_id, image_url, display_image_kind FROM public.v_consumer_offers WHERE id = ANY($1::uuid[])`,
      [offer5Ids]
    );
    expect(vco5Final.rows.every((r: any) => Boolean(r.image_url) && r.display_image_kind === 'exact_product')).toBe(true);
    const vco10Final = await pgClient.query(
      `SELECT id::text, product_id, image_url FROM public.v_consumer_offers WHERE id = ANY($1::uuid[])`,
      [offer10Ids]
    );
    expect(vco10Final.rows.every((r: any) => r.image_url === null)).toBe(true);
    expect(vco10Final.rows.every((r: any) => ![19, 20, 21, 36].includes(Number(r.product_id)))).toBe(true);

    // 6. Test Independent Identity-Only Correction (authIdentity = true, authImages = false) when 10kg replacement photos are unavailable!
    // Reset DB offers/products cleanly to shared state for this standalone identity-only check:
    await pgClient.query(`DELETE FROM public.product_images`);
    await pgClient.query(`DELETE FROM public.offer_display_images`);
    for (let i = 0; i < riceSpecs.length; i++) {
      await pgClient.query(`UPDATE public.offers SET product_id = $1, catalog_match_status = 'unresolved', image_url = NULL, thumbnail_url = NULL WHERE id = $2`, [
        riceSpecs[i].id,
        offer10Ids[i]
      ]);
      await pgClient.query(`UPDATE public.offers SET product_id = $1, image_url = NULL, thumbnail_url = NULL WHERE id = $2`, [
        riceSpecs[i].id,
        offer5Ids[i]
      ]);
    }
    await pgClient.query(`DELETE FROM public.products WHERE id NOT IN (19, 20, 21, 36)`);
    resetFixtureFiles();

    const idOnlyRes = await service.repairPublishedOfferImages({
      batchId,
      operatorAuthorizedRepair: false,
      operatorAuthorizedIdentityCorrection: true,
      databaseContext: 'DEVELOPMENT_TEST',
      pgClient
    });
    expect(idOnlyRes.identityCorrectedCount).toBe(4);
    expect(idOnlyRes.repairedCount).toBe(0);
    for (const r of riceSpecs) {
      const item10 = idOnlyRes.repairs.find((x) => x.sourceOfferId === `leaflet-001_p018_${r.num}__tier_2`)!;
      expect(item10.status).toBe('identity_corrected_only');
    }
    // Zero 10kg offer inherited any 5kg image, all 10kg offers relinked to 10kg candidate products, and 5kg tiers NOW unlock in Preview!
    const offersAfterIdOnly = await pgClient.query(
      `SELECT o.id::text, o.product_id, p.each_size_value::float8 AS p_size
       FROM public.offers o JOIN public.products p ON p.id = o.product_id
       WHERE o.id = ANY($1::uuid[])`,
      [offer10Ids]
    );
    expect(offersAfterIdOnly.rows).toHaveLength(4);
    expect(offersAfterIdOnly.rows.every((r: any) => ![19, 20, 21, 36].includes(Number(r.product_id)) && Number(r.p_size) === 10)).toBe(true);
    const vco10IdOnly = await pgClient.query(
      `SELECT id::text, product_id, image_url FROM public.v_consumer_offers WHERE id = ANY($1::uuid[])`,
      [offer10Ids]
    );
    expect(vco10IdOnly.rows.every((r: any) => r.image_url === null)).toBe(true);

    const unlockedPreview = await service.previewPublishedOfferImageRepairs({
      batchId,
      databaseContext: 'DEVELOPMENT_TEST',
      pgClient
    });
    expect(unlockedPreview.readyForRepairCount).toBe(5); // Sadia + all 4 5kg rice offers unlocked now that 10kg identities separated!
    for (const r of riceSpecs) {
      const t1After = unlockedPreview.repairs.find((x) => x.sourceOfferId === `leaflet-001_p018_${r.num}__tier_1`)!;
      expect(t1After.repairEligibility).toBe('ready_for_repair');
      expect(t1After.dependsOnSiblingIdentityCorrection).toBe(false);
    }
  });
});
