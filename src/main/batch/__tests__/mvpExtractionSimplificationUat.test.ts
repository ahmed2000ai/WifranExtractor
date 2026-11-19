import { describe, expect, it } from 'vitest';
import {
  buildPendingSupermarketCatalogEntry,
  parseBilingualSupermarketInput,
  toAsciiSlug
} from '../../../shared/utils/supermarketCandidateUtils';
import { isLeafletMetadataAccepted } from '../../../shared/utils/reviewTriageClassifier';
import { parseValidityDates } from '../../metadata/validityDateParser';
import { revalidateOfferItem } from '../../../shared/utils/offerRevalidation';
import { estimateBatchApiCost } from '../../../shared/utils/geminiPricingAndCostEstimator';

describe('Wifran MVP Extraction Simplification UAT Test Suite', () => {
  it('1. Routine Hybrid V3 extraction sets expected crops per page to zero (0 B2 crop calls)', () => {
    const est = estimateBatchApiCost({
      targetPageCount: 5,
      extractionPipelineMode: 'hybrid_v3',
      tier: 'flex'
    });
    // In routine hybrid_v3, crop calls are disabled (0 B2 crop calls)
    expect(est.expectedCropsPerPageLow).toBe(0);
    expect(est.expectedCropsPerPageMid).toBe(0);
    expect(est.expectedCropsPerPageHigh).toBe(0);
    expect(est.estimatedCropLowUsd).toBe(0);
    expect(est.estimatedCropHighUsd).toBe(0);
    expect(est.estimatedFullPageLowUsd).toBeGreaterThan(0);
  });

  it('2. Validity date parser correctly prioritizes explicit promotion valid statement and parses DD/MM - DD/MM/YYYY', () => {
    const parsed = parseValidityDates('PROMOTION VALID FROM 16/11 - 30/11/2026');
    expect(parsed).not.toBeNull();
    expect(parsed?.startDate).toBe('2026-11-16');
    expect(parsed?.endDate).toBe('2026-11-30');
    expect(parsed?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('3. False verification states are prevented when retailer or dates are unresolved', () => {
    // Missing supermarketId
    expect(
      isLeafletMetadataAccepted({
        supermarketId: null,
        offerStartDate: '2026-11-16',
        offerEndDate: '2026-11-30',
        metadataStatus: 'operator_verified'
      })
    ).toBe(false);

    // needs_review status
    expect(
      isLeafletMetadataAccepted({
        supermarketId: 'sm_123',
        offerStartDate: '2026-11-16',
        offerEndDate: '2026-11-30',
        metadataStatus: 'needs_review'
      })
    ).toBe(false);

    // All core fields present and operator verified
    expect(
      isLeafletMetadataAccepted({
        supermarketId: 'sm_123',
        offerStartDate: '2026-11-16',
        offerEndDate: '2026-11-30',
        metadataStatus: 'operator_verified'
      })
    ).toBe(true);
  });

  it('4. New Supermarket creation pre-fills detected bilingual names and avoids duplicates', () => {
    const detected = parseBilingualSupermarketInput('Al Nokhba Markets / أسواق النخبة');
    expect(detected.hasExplicitBilingualPair).toBe(true);
    expect(detected.resolvedNameEn).toBe('Al Nokhba Markets');
    expect(detected.resolvedNameAr).toBe('أسواق النخبة');

    const created = buildPendingSupermarketCatalogEntry({
      detectedName: 'Al Nokhba Markets',
      resolvedNameEn: 'Al Nokhba Markets',
      resolvedNameAr: 'أسواق النخبة',
      preferExplicitNames: true
    });
    expect(created.entry.name_en).toBe('Al Nokhba Markets');
    expect(created.entry.name_ar).toBe('أسواق النخبة');
    expect(created.entry.slug).toBe('al-nokhba');
    expect(created.entry.pendingCatalogCreation).toBe(true);
    expect(created.alreadyInCatalog).toBe(false);

    // Deduplication check
    const duplicate = buildPendingSupermarketCatalogEntry({
      detectedName: 'Al Nokhba Markets',
      resolvedNameEn: 'Al Nokhba Markets',
      resolvedNameAr: 'أسواق النخبة',
      existingCatalog: [created.entry]
    });
    expect(duplicate.alreadyInCatalog).toBe(true);
    expect(duplicate.entry.id).toBe(created.entry.id);
  });

  it('5. Safe multi-variant assortment offer (Sadia 700g/750g) revalidates as clean with zero blocking errors', () => {
    const reval = revalidateOfferItem({
      item: {
        titleEn: 'Sadia Broasted Chicken 700g / 750g — Assorted',
        titleAr: 'دجاج بروستد ساديا ٧٠٠ / ٧٥٠ جم — متنوع',
        brand: 'Sadia',
        priceAfter: 19.99,
        assortment_status: 'unsplit_assortment',
        each_size_value: 700,
        each_size_unit: 'g',
        productThumbLocalPath: 'C:\\fake\\product_thumb_crop.webp',
        imageSubjectScope: 'product_package'
      },
      leafletMetadata: {
        supermarketId: 'al-nokhba-markets',
        offerStartDate: '2026-11-16',
        offerEndDate: '2026-11-30',
        metadataStatus: 'operator_verified'
      }
    });

    expect(reval.isValid).toBe(true);
    expect(reval.quarantineReasons).toEqual([]);
    expect(reval.blockingErrors).toEqual([]);
    expect(reval.imageSubjectScope).toBe('representative_assortment');
  });

  it('6. toAsciiSlug generates deterministic slug for Arabic and Latin retailer names', () => {
    expect(toAsciiSlug('Al Nokhba Markets')).toBe('al-nokhba');
    expect(toAsciiSlug('أسواق النخبة')).toMatch(/^[a-z0-9-]+$/);
  });
});
