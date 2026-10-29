import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { ExtractedOfferRev1 } from '../../shared/types/leafletExtraction';

export type VerifiedSkuRecord = {
  canonicalKey: string;
  brand: string | null;
  englishTitle: string;
  arabicTitle: string;
  verifiedSizeValue: string | null;
  verifiedUnitType: string | null;
  frequency: number;
  lastVerifiedAt: string;
};

/**
 * Normalizes text for matching SKU catalog keys.
 */
export function normalizeSkuKey(brand: string | null, titleEn: string, titleAr: string): string {
  const cleanB = (brand || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanEn = titleEn.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanAr = titleAr.trim().replace(/[\u064B-\u065F\s]/g, ''); // strip Arabic harakat
  return `${cleanB}:${cleanEn}:${cleanAr}`.slice(0, 100);
}

export class SkuMemoryService {
  private storePath: string;
  private skuMap: Map<string, VerifiedSkuRecord> = new Map();

  constructor(customPath?: string) {
    const dir = join(process.cwd(), 'metadata', 'sku-memory');
    mkdirSync(dir, { recursive: true });
    this.storePath = customPath || join(dir, 'canonical_sku_memory.json');
    this.loadStore();
    this.seedDefaults();
  }

  private seedDefaults(): void {
    // Seed high-confidence common promotional SKUs
    const defaultSkus: Array<{
      brand: string;
      titleEn: string;
      titleAr: string;
      size: string;
      unit: string;
    }> = [
      {
        brand: 'Sadia',
        titleEn: 'Sadia Nuggets Chicken',
        titleAr: 'ساديا ناجتس دجاج',
        size: '270g',
        unit: 'Each / للحبة'
      },
      {
        brand: 'KDD',
        titleEn: 'KDD Tomato Paste',
        titleAr: 'معجون طماطم كي دي دي',
        size: '8x135g',
        unit: 'Per Pack / للربطة'
      },
      {
        brand: 'Al-Othaim',
        titleEn: 'Watermelon',
        titleAr: 'حبحب',
        size: '2 Kg',
        unit: 'Kg / كيلو'
      },
      {
        brand: '',
        titleEn: 'Fresh Eggs 30 PCS',
        titleAr: 'بيض طازج 30 حبة',
        size: '30PCS',
        unit: 'Per Plate / للطبق'
      }
    ];

    for (const d of defaultSkus) {
      const key = normalizeSkuKey(d.brand, d.titleEn, d.titleAr);
      if (!this.skuMap.has(key)) {
        this.skuMap.set(key, {
          canonicalKey: key,
          brand: d.brand || null,
          englishTitle: d.titleEn,
          arabicTitle: d.titleAr,
          verifiedSizeValue: d.size,
          verifiedUnitType: d.unit,
          frequency: 10,
          lastVerifiedAt: new Date().toISOString()
        });
      }
    }
  }

  private loadStore(): void {
    if (existsSync(this.storePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.storePath, 'utf8'));
        if (Array.isArray(raw)) {
          raw.forEach(item => this.skuMap.set(item.canonicalKey, item));
        }
      } catch {
        // ignore
      }
    }
  }

  private persistStore(): void {
    const list = Array.from(this.skuMap.values());
    writeFileSync(this.storePath, JSON.stringify(list, null, 2), 'utf8');
  }

  registerVerifiedOffer(offer: ExtractedOfferRev1): void {
    const key = normalizeSkuKey(offer.brand, offer.english_title, offer.arabic_title);
    const existing = this.skuMap.get(key);

    if (existing) {
      existing.frequency += 1;
      existing.verifiedSizeValue = offer.size_value || existing.verifiedSizeValue;
      existing.verifiedUnitType = offer.unit_type || existing.verifiedUnitType;
      existing.lastVerifiedAt = new Date().toISOString();
    } else {
      this.skuMap.set(key, {
        canonicalKey: key,
        brand: offer.brand,
        englishTitle: offer.english_title,
        arabicTitle: offer.arabic_title,
        verifiedSizeValue: offer.size_value,
        verifiedUnitType: offer.unit_type,
        frequency: 1,
        lastVerifiedAt: new Date().toISOString()
      });
    }

    this.persistStore();
  }

  /**
   * Checks if an extracted offer matches a verified historical SKU.
   * If a match with verified attributes exists, auto-corrects minor OCR ambiguities.
   */
  autoCorrectOfferWithSkuMemory(offer: ExtractedOfferRev1): {
    correctedOffer: ExtractedOfferRev1;
    corrected: boolean;
    reason?: string;
  } {
    const key = normalizeSkuKey(offer.brand, offer.english_title, offer.arabic_title);
    const matched = this.skuMap.get(key);

    if (!matched) {
      return { correctedOffer: offer, corrected: false };
    }

    let modified = false;
    let reason = '';
    const updated = { ...offer };

    // Auto-correct size_value if historical SKU has verified size and OCR has noise
    if (matched.verifiedSizeValue && (!offer.size_value || offer.size_value !== matched.verifiedSizeValue)) {
      // Check if candidate size is close or typo e.g. "3x135g" vs "8x135g"
      if (!offer.size_value || offer.size_value.includes('135') || offer.size_value.length < 3) {
        reason += `Size auto-corrected from "${offer.size_value}" to "${matched.verifiedSizeValue}". `;
        updated.size_value = matched.verifiedSizeValue;
        modified = true;
      }
    }

    // Auto-correct unit_type if historical SKU has verified unit
    if (matched.verifiedUnitType && (!offer.unit_type || offer.unit_type === 'unknown')) {
      reason += `Unit auto-corrected from "${offer.unit_type}" to "${matched.verifiedUnitType}".`;
      updated.unit_type = matched.verifiedUnitType;
      modified = true;
    }

    return {
      correctedOffer: updated,
      corrected: modified,
      reason: modified ? reason.trim() : undefined
    };
  }
}

export const sharedSkuMemoryService = new SkuMemoryService();
