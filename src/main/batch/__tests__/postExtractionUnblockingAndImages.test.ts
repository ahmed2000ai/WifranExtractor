import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { normalizeAssortedTitle, revalidateOfferItem } from '../../../shared/utils/offerRevalidation';
import { TemporaryProductRegistry } from '../../db/temporaryProductRegistry';
import { BatchOrchestrationService } from '../batchOrchestrationService';

describe('Post-Extraction Unblocking & Consumer Images Unit Tests (Offline, Zero Gemini Calls)', () => {
  let tempDir: string;
  let batchesDir: string;
  let batchId: string;
  let batchDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-unblock-test-'));
    batchesDir = path.join(tempDir, 'batches');
    batchId = 'batch-test-unblock-001';
    batchDir = path.join(batchesDir, batchId);
    fs.mkdirSync(batchDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('1. normalizeAssortedTitle appends — Assorted and — متنوع correctly and avoids duplicate suffixes', () => {
    const en = normalizeAssortedTitle('Dove Shampoo 400ml', 'en');
    const ar = normalizeAssortedTitle('دوف شامبو ٤٠٠ مل', 'ar');
    expect(en).toBe('Dove Shampoo 400ml — Assorted');
    expect(ar).toBe('دوف شامبو ٤٠٠ مل — متنوع');

    // Calling again does not duplicate the suffix
    const en2 = normalizeAssortedTitle(en, 'en');
    const ar2 = normalizeAssortedTitle(ar, 'ar');
    expect(en2).toBe('Dove Shampoo 400ml — Assorted');
    expect(ar2).toBe('دوف شامبو ٤٠٠ مل — متنوع');
  });

  it('2. revalidateOfferItem clears assortment blocking conflicts when assortment_status is unsplit_assortment', () => {
    const item = {
      source_page_number: 1,
      source_item_number: '013',
      titleEn: 'Dove Shampoo / Conditioner 400ml / 340ml — Assorted',
      titleAr: 'دوف شامبو / بلسم ٤٠٠ / ٣٤٠ مل — متنوع',
      priceAfter: 9.5,
      priceBefore: 18.5,
      currency: 'SAR',
      assortment_status: 'unsplit_assortment' as const,
      category: 'personal-care',
      each_size_value: 400,
      each_size_unit: 'ml',
      productThumbLocalPath: 'C:\\fake\\crops\\offer-013\\product_thumb_crop.webp',
      conflictCodes: ['INCOMPLETE_VISIBLE_ASSORTMENT', 'TEXT_ASSORTMENT_KEYWORD']
    };

    const reval = revalidateOfferItem({
      item,
      leafletMetadata: {
        supermarketId: 'al-nokhba-markets',
        offerStartDate: '2026-11-16',
        offerEndDate: '2026-11-30',
        metadataStatus: 'operator_verified'
      }
    });

    expect(reval.isValid).toBe(true);
    expect(reval.v3RetentionMode).toBe('unsplit_assortment');
    expect(reval.quarantineReasons).toEqual([]);
    expect(reval.blockingErrors).toEqual([]);
    expect(reval.imageSubjectScope).toBe('representative_assortment');
  });

  it('3. Grain variety discrimination distinguishes Prime Calrose Rice from Prime Abu Al Houl Rice', () => {
    const registry = new TemporaryProductRegistry(batchId);

    const rice1 = {
      brandKey: 'prime',
      brandNameEn: 'Prime',
      brandNameAr: 'برايم',
      productNameEn: 'Prime Rice Abu Al Houl 5kg',
      productNameAr: 'أرز أبو الهول برايم ٥ كجم',
      eachSizeValue: 5,
      eachSizeUnit: 'kg',
      innerPackCount: 1,
      evidenceAnnotation: {
        rawOcrTextEn: 'Prime Rice Abu Al Houl 5kg',
        rawOcrTextAr: 'أرز أبو الهول برايم ٥ كجم'
      }
    };

    const rice2Calrose = {
      brandKey: 'prime',
      brandNameEn: 'Prime',
      brandNameAr: 'برايم',
      productNameEn: 'Prime Calrose Rice (Abu Houl) 5kg',
      productNameAr: 'أرز كالروز برايم أبو هول ٥ كجم',
      eachSizeValue: 5,
      eachSizeUnit: 'kg',
      innerPackCount: 1,
      evidenceAnnotation: {
        rawOcrTextEn: 'Prime Calrose Rice (Abu Houl) 5kg',
        rawOcrTextAr: 'أرز كالروز برايم أبو هول ٥ كجم'
      }
    };

    const fp1 = registry.buildCanonicalIdentityFingerprint(rice1 as any);
    const fp2 = registry.buildCanonicalIdentityFingerprint(rice2Calrose as any);

    // Fingerprints must be distinct because Calrose is recognized as a distinguishing grain variety concept
    expect(fp1).not.toBe(fp2);
    expect(fp2).toContain('calrose');

    // Equivalence comparison must return false
    const equivalent = registry.areIdentitiesEquivalent(rice2Calrose as any, rice1 as any);
    expect(equivalent).toBe(false);
  });

  it('4. Revalidation allows unbranded commodity items when marked with commodityTag', () => {
    const rohuFish = {
      source_page_number: 1,
      source_item_number: '012',
      titleEn: 'Big Aye Croaker Rohu Fresh Fish Per KG',
      titleAr: 'سمك روهو طازج للكيلو',
      priceAfter: 12.95,
      priceBefore: 18.0,
      currency: 'SAR',
      sale_unit_type: 'kg',
      brand: null,
      commodity_tag: 'fish_fresh',
      category: 'fresh-food',
      productThumbLocalPath: 'C:\\fake\\crops\\offer-012\\product_thumb_crop.webp'
    };

    const reval = revalidateOfferItem({
      item: rohuFish,
      leafletMetadata: {
        supermarketId: 'al-nokhba-markets',
        offerStartDate: '2026-11-16',
        offerEndDate: '2026-11-30',
        metadataStatus: 'operator_verified'
      }
    });

    // Unbranded commodity fish item is valid for grocery scope
    expect(reval.isValid).toBe(true);
    expect(reval.blockingErrors).toEqual([]);
    expect(reval.quarantineReasons).toEqual([]);
  });

  it('5. Batch orchestration resolveOfferAsAssorted updates draft and manifest atomically', async () => {
    const cropPath = path.join(batchDir, 'product_thumb_crop.webp');
    fs.writeFileSync(cropPath, 'fake-webp-bytes');

    const manifest = {
      batchId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'completed',
      totals: { totalPdfs: 1, completedPdfs: 1, failedPdfs: 0, totalPages: 1, processedPages: 1, totalOffers: 1 },
      leaflets: [
        {
          leafletId: 'leaflet-001',
          filePath: 'C:\\fake\\alnokhbah.pdf',
          fileName: 'alnokhbah.pdf',
          fileFingerprint: 'fp123',
          pageCount: 1,
          selectedPages: [1],
          processedPages: [1],
          workspacePath: batchDir,
          metadata: {
            supermarketId: 'e42b923f-5682-4a55-9650-0bc4562c7c66',
            offerStartDate: '2026-11-16',
            offerEndDate: '2026-11-30',
            metadataStatus: 'operator_verified'
          },
          status: 'completed'
        }
      ]
    };
    fs.writeFileSync(path.join(batchDir, 'batch-manifest.json'), JSON.stringify(manifest, null, 2));

    const draft = {
      batchId,
      leafletId: 'leaflet-001',
      updatedAt: new Date().toISOString(),
      metadata: {
        supermarketId: 'e42b923f-5682-4a55-9650-0bc4562c7c66',
        offerStartDate: '2026-11-16',
        offerEndDate: '2026-11-30',
        metadataStatus: 'operator_verified'
      },
      items: [
        {
          sourceOfferId: 'leaflet-001_p001_013',
          source_page_number: 1,
          source_item_number: '013',
          brand: 'Dove',
          brandEn: 'Dove',
          brandAr: 'دوف',
          titleEn: 'Dove Shampoo 400ml',
          titleAr: 'دوف شامبو ٤٠٠ مل',
          priceAfter: 9.5,
          priceBefore: 18.5,
          currency: 'SAR',
          assortment_status: 'single_sku',
          category: 'personal-care',
          each_size_value: 400,
          each_size_unit: 'ml',
          productThumbLocalPath: cropPath,
          consumerProductImagePath: null,
          conflictCodes: ['INCOMPLETE_VISIBLE_ASSORTMENT']
        }
      ]
    };
    fs.writeFileSync(path.join(batchDir, 'staged-draft.json'), JSON.stringify(draft, null, 2));

    const matchingDir = path.join(batchDir, 'catalog-matching');
    fs.mkdirSync(matchingDir, { recursive: true });
    const matchingManifestPath = path.join(matchingDir, 'matching-proposals.json');

    const matchingManifest = {
      schemaVersion: '1.0',
      batchId,
      runId: 'match-001',
      status: 'completed',
      model: 'deterministic',
      thinkingLevel: 'MEDIUM',
      executionMode: 'flex',
      totals: { totalOffers: 1, autoMatchedOffers: 0, proposedMatches: 1, rejectedMatches: 0, pendingVerification: 0 },
      proposals: {
        'leaflet-001_p001_013': {
          batchOfferKey: `${batchId}:leaflet-001:1:leaflet-001_p001_013`,
          sourceOfferId: 'leaflet-001_p001_013',
          sourcePageNumber: 1,
          matchedProductId: null,
          isNewProductCandidate: true,
          productClassification: 'temporary_group',
          temporaryProductGroupKey: 'temp:dove_001',
          temporaryProductGroupLabel: 'Dove Shampoo',
          matchKind: 'no_match',
          matchConfidence: 0.9,
          matchConfidenceScore: 0.9,
          autoApproved: false,
          requiresHumanReview: true,
          reviewReasons: [],
          conflictCodes: ['INCOMPLETE_VISIBLE_ASSORTMENT'],
          validationIssues: [],
          operatorDecision: 'proposed',
          updatedAt: new Date().toISOString()
        }
      },
      consumerImageApprovals: {}
    };
    fs.writeFileSync(matchingManifestPath, JSON.stringify(matchingManifest, null, 2));

    const service = new BatchOrchestrationService(batchesDir);

    const batchOfferKey = `${batchId}:leaflet-001:1:leaflet-001_p001_013`;
    const result = await service.resolveOfferAsAssorted({
      batchId,
      batchOfferKey,
      appendAssortedSuffix: true
    });

    expect(result.batchOfferKey).toBe(batchOfferKey);

    // Read back staged draft
    const updatedDraft = JSON.parse(fs.readFileSync(path.join(batchDir, 'staged-draft.json'), 'utf8'));
    const updatedOffer = updatedDraft.items[0];

    expect(updatedOffer.assortment_status).toBe('unsplit_assortment');
    expect(updatedOffer.titleEn).toBe('Dove Shampoo 400ml — Assorted');
    expect(updatedOffer.titleAr).toBe('دوف شامبو ٤٠٠ مل — متنوع');
    expect(updatedOffer.conflictCodes).not.toContain('INCOMPLETE_VISIBLE_ASSORTMENT');
    expect(updatedOffer.selectedImageSource).toBe('product_thumb');

    // Read back matching run manifest
    const updatedMatching = JSON.parse(fs.readFileSync(matchingManifestPath, 'utf8'));
    const approval = updatedMatching.consumerImageApprovals[batchOfferKey];
    expect(approval).toBeDefined();
    expect(approval.status).toBe('approved_generated_crop');
    expect(approval.sourceType).toBe('product_thumb_crop');
    expect(approval.approvedForProductKey).toMatch(/^temp:t_/);
  });
});
