import { describe, it, expect } from 'vitest';
import {
  normalizeEntityText,
  stripSupermarketNoiseWords,
  lookupSupermarketSynonym,
  toAsciiSlug,
  findMatchingCatalogSupermarket,
  buildPendingSupermarketCatalogEntry,
  parseBilingualSupermarketInput,
  extractApiDetectedRetailerCandidate,
  getDefaultNewSupermarketPromptValue,
  mergeSupermarketCatalogLists,
  type SupermarketCatalogCandidate
} from '../supermarketCandidateUtils';

describe('supermarketCandidateUtils', () => {
  it('normalizes Arabic/English variants and strips supermarket noise words', () => {
    expect(normalizeEntityText('أسواق الدُّكَّان')).toBe('اسواق الدكان');
    expect(stripSupermarketNoiseWords('Hyper Panda Supermarket KSA')).toBe('panda');
    expect(stripSupermarketNoiseWords('أسواق بنده هايبرماركت')).toBe('بنده');
  });

  it('resolves known bilingual synonyms including الدكان -> dukan', () => {
    expect(lookupSupermarketSynonym('الدكان')).toEqual({
      slug: 'dukan',
      name_en: 'Dukan',
      name_ar: 'الدكان'
    });
    expect(lookupSupermarketSynonym('حصرياً على موقع الدكان')).toBeNull();
    expect(lookupSupermarketSynonym('أسواق الدكان')).toEqual({
      slug: 'dukan',
      name_en: 'Dukan',
      name_ar: 'الدكان'
    });
    expect(toAsciiSlug('الدكان')).toBe('dukan');
  });

  it('transliterates unknown Arabic chain names to ASCII slugs and falls back to deterministic hash for symbols', () => {
    const gulfSlug = toAsciiSlug('سوق الخليج المركزي');
    expect(gulfSlug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(gulfSlug).toContain('alkhlyj');

    const symbolSlug1 = toAsciiSlug('★ ★ ★');
    const symbolSlug2 = toAsciiSlug('★ ★ ★');
    expect(symbolSlug1).toMatch(/^sm-[0-9a-f]{8}$/);
    expect(symbolSlug1).toBe(symbolSlug2);
  });

  it('matches catalog supermarkets across ID, slug, synonyms, and bilingual variants', () => {
    const catalog = [
      { id: 'sm-1', slug: 'panda', name_en: 'Panda', name_ar: 'بنده' },
      { id: 'sm-2', slug: 'danube', name_en: 'Danube', name_ar: 'الدانوب' }
    ];

    expect(findMatchingCatalogSupermarket({ detectedName: 'هايبر بنده' }, catalog)?.id).toBe('sm-1');
    expect(findMatchingCatalogSupermarket({ detectedName: 'دانوب' }, catalog)?.id).toBe('sm-2');
    expect(findMatchingCatalogSupermarket({ resolvedRetailerId: 'sm-2' }, catalog)?.id).toBe('sm-2');
    expect(findMatchingCatalogSupermarket({ detectedName: 'الدكان' }, catalog)).toBeUndefined();
  });

  it('builds a pending catalog entry for unmatched الدكان with zero DB IDs and avoids duplicating catalog entries', () => {
    const catalog = [
      { id: 'sm-1', slug: 'panda', name_en: 'Panda', name_ar: 'بنده' }
    ];

    const built = buildPendingSupermarketCatalogEntry({
      detectedName: 'الدكان',
      existingCatalog: catalog
    });

    expect(built.alreadyInCatalog).toBe(false);
    expect(built.entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(built.entry.slug).toBe('dukan');
    expect(built.entry.name_en).toBe('Dukan');
    expect(built.entry.name_ar).toBe('الدكان');
    expect(built.entry.pendingCatalogCreation).toBe(true);

    const repeated = buildPendingSupermarketCatalogEntry({
      detectedName: 'دكان',
      existingCatalog: [...catalog, built.entry]
    });
    expect(repeated.alreadyInCatalog).toBe(true);
    expect(repeated.entry.id).toBe(built.entry.id);
  });

  it('merges catalog lists without duplicates and replaces pending entries with authoritative DB rows', () => {
    const pendingDukan: SupermarketCatalogCandidate = {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'dukan',
      name_en: 'Dukan',
      name_ar: 'الدكان',
      is_active: true,
      pendingCatalogCreation: true
    };
    const dbDukan: SupermarketCatalogCandidate = {
      id: '99999999-9999-4999-8999-999999999999',
      slug: 'dukan',
      name_en: 'Dukan',
      name_ar: 'الدكان',
      is_active: true
    };

    const mergedBeforePublish = mergeSupermarketCatalogLists([], [pendingDukan], [pendingDukan]);
    expect(mergedBeforePublish).toHaveLength(1);
    expect(mergedBeforePublish[0].pendingCatalogCreation).toBe(true);

    const mergedAfterPublish = mergeSupermarketCatalogLists([dbDukan], [pendingDukan]);
    expect(mergedAfterPublish).toHaveLength(1);
    expect(mergedAfterPublish[0].id).toBe(dbDukan.id);
    expect(mergedAfterPublish[0].pendingCatalogCreation).toBeUndefined();

    const mergedPendingFirstThenDb = mergeSupermarketCatalogLists([pendingDukan], [dbDukan]);
    expect(mergedPendingFirstThenDb).toHaveLength(1);
    expect(mergedPendingFirstThenDb[0].id).toBe(dbDukan.id);
    expect(mergedPendingFirstThenDb[0].pendingCatalogCreation).toBeUndefined();
  });

  it('parses bilingual "EN / AR" and "AR / EN" inputs and preserves operator edits over synonyms', () => {
    expect(parseBilingualSupermarketInput('Dukan / الدكان')).toEqual({
      detectedName: 'Dukan / الدكان',
      resolvedNameEn: 'Dukan',
      resolvedNameAr: 'الدكان',
      hasExplicitBilingualPair: true
    });
    expect(parseBilingualSupermarketInput('الدكان / Dukan')).toEqual({
      detectedName: 'الدكان / Dukan',
      resolvedNameEn: 'Dukan',
      resolvedNameAr: 'الدكان',
      hasExplicitBilingualPair: true
    });
    expect(parseBilingualSupermarketInput('سوق الخليج')).toEqual({
      detectedName: 'سوق الخليج',
      hasExplicitBilingualPair: false
    });

    const editedFromDefault = buildPendingSupermarketCatalogEntry({
      detectedName: 'Dukan Mart / الدكان',
      resolvedNameEn: 'Dukan Mart',
      resolvedNameAr: 'الدكان',
      preferExplicitNames: true,
      existingCatalog: []
    });
    expect(editedFromDefault.entry.name_en).toBe('Dukan Mart');
    expect(editedFromDefault.entry.name_ar).toBe('الدكان');
    expect(editedFromDefault.entry.slug).toBe('dukan-mart');

    const gulfBilingual = buildPendingSupermarketCatalogEntry({
      detectedName: 'Gulf Market / سوق الخليج',
      resolvedNameEn: 'Gulf Market',
      resolvedNameAr: 'سوق الخليج',
      preferExplicitNames: true,
      existingCatalog: []
    });
    expect(gulfBilingual.entry.name_en).toBe('Gulf Market');
    expect(gulfBilingual.entry.name_ar).toBe('سوق الخليج');
    expect(gulfBilingual.entry.slug).toBe('gulf');
  });

  it('derives default New supermarket prompt value from API discovery and recovers original detected name past manual overrides', () => {
    expect(
      getDefaultNewSupermarketPromptValue({
        detectedName: 'الدكان',
        resolvedRetailerId: null,
        resolvedSlug: 'dukan',
        resolvedNameEn: 'Dukan',
        resolvedNameAr: 'الدكان'
      })
    ).toBe('Dukan / الدكان');

    expect(
      getDefaultNewSupermarketPromptValue({
        detectedName: 'الدكان',
        resolvedRetailerId: null
      })
    ).toBe('Dukan / الدكان');

    expect(
      getDefaultNewSupermarketPromptValue({
        detectedName: 'Al Wafa',
        resolvedRetailerId: null,
        resolvedSlug: 'al-wafa',
        resolvedNameEn: 'Al Wafa Hypermarket',
        resolvedNameAr: 'أسواق الوفاء المركزية'
      })
    ).toBe('Al Wafa Hypermarket / أسواق الوفاء المركزية');

    expect(
      getDefaultNewSupermarketPromptValue({
        detectedName: 'سوق الخليج',
        resolvedRetailerId: null
      })
    ).toBe('سوق الخليج');

    expect(
      getDefaultNewSupermarketPromptValue({
        detectedName: 'Metro Mart',
        resolvedRetailerId: null
      })
    ).toBe('Metro Mart');

    // Wrong manual catalog override (Farm Superstores confirmed over API-detected الدكان)
    expect(
      getDefaultNewSupermarketPromptValue({
        detectedName: 'الدكان',
        resolvedRetailerId: 'farm-uuid',
        resolvedSlug: 'farm',
        resolvedNameEn: 'Farm Superstores',
        resolvedNameAr: 'أسواق المزرعة',
        status: 'confirmed',
        evidenceText: 'Operator entered manually'
      })
    ).toBe('Dukan / الدكان');

    // Purely manual selection with no API-returned retailer
    expect(
      extractApiDetectedRetailerCandidate(
        {
          detectedName: 'Farm Superstores',
          resolvedRetailerId: 'farm-uuid',
          resolvedSlug: 'farm',
          resolvedNameEn: 'Farm Superstores',
          resolvedNameAr: 'أسواق المزرعة',
          status: 'confirmed',
          evidenceText: 'Operator entered manually'
        },
        [{ field: 'retailer', method: 'operator_manual' }]
      )
    ).toBeNull();
    expect(getDefaultNewSupermarketPromptValue(null)).toBe('');
  });
});
