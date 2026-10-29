import { describe, it, expect } from 'vitest';
import {
  normalizePriceValue,
  normalizeExtractedOffer,
  parseAndNormalizeQuantity,
  normalizeArabicNumerals,
  canonicalizeUnit,
  detectItemDomainFromTitle
} from '../priceAndUnitNormalizer';
import type { ExtractedOfferRev1 } from '../../types/leafletExtraction';

describe('priceAndUnitNormalizer Shared Unit Tests', () => {
  it('should normalize hyphenated prices and dashes', () => {
    expect(normalizePriceValue('18-99')).toBe(18.99);
    expect(normalizePriceValue('16-99')).toBe(16.99);
    expect(normalizePriceValue('10-99')).toBe(10.99);
    expect(normalizePriceValue('6-99')).toBe(6.99);
    expect(normalizePriceValue('18–99')).toBe(18.99);
    expect(normalizePriceValue('18—99')).toBe(18.99);
  });

  it('should normalize superscript/spaced halalas', () => {
    expect(normalizePriceValue('14 95')).toBe(14.95);
    expect(normalizePriceValue('5 00')).toBe(5.0);
  });

  it('should convert Arabic-Indic numerals and punctuation', () => {
    expect(normalizeArabicNumerals('٩٠٠ جم × ١٠')).toBe('900 جم x 10');
    expect(normalizeArabicNumerals('٢,٢٥ كيلو')).toBe('2.25 كيلو');
    expect(normalizeArabicNumerals('٣٠ حبة')).toBe('30 حبة');
  });

  it('should canonicalize all unit aliases in English and Arabic', () => {
    expect(canonicalizeUnit('gm')).toBe('g');
    expect(canonicalizeUnit('gms')).toBe('g');
    expect(canonicalizeUnit('جم')).toBe('g');
    expect(canonicalizeUnit('جرام')).toBe('g');
    expect(canonicalizeUnit('غ')).toBe('g');
    expect(canonicalizeUnit('kg')).toBe('kg');
    expect(canonicalizeUnit('كيلو')).toBe('kg');
    expect(canonicalizeUnit('كجم')).toBe('kg');
    expect(canonicalizeUnit('ml')).toBe('ml');
    expect(canonicalizeUnit('مل')).toBe('ml');
    expect(canonicalizeUnit('L')).toBe('l');
    expect(canonicalizeUnit('لتر')).toBe('l');
    expect(canonicalizeUnit('pcs')).toBe('pcs');
    expect(canonicalizeUnit('حبة')).toBe('pcs');
    expect(canonicalizeUnit('طبق')).toBe('pcs');
  });

  it('should parse 30s egg tray: pack_quantity 1, each_size_value 30, pcs, total 30, Comp: Eligible', () => {
    const res = parseAndNormalizeQuantity({
      size_text: '30s',
      title_en: 'Al Failaq Fresh White Large Eggs 30s',
      title_ar: 'الفيلق بيض أبيض كبير ٣٠ حبة',
      offer_price: 13.99
    });

    expect(res.pack_quantity).toBe(1);
    expect(res.each_size_value).toBe(30);
    expect(res.each_size_unit).toBe('pcs');
    expect(res.total_content_value).toBe(30);
    expect(res.standardized_unit).toBe('piece');
    expect(res.standardized_total_value).toBe(30);
    expect(res.standardized_unit_price).toBe(0.47); // 13.99 / 30 = 0.47
    expect(res.comparison_eligible).toBe(true);
    expect(res.exclusion_reason).toBeNull();
  });

  it('should parse 900gmx10: pack_quantity 10, each_size_value 900, g, total 9000 (9kg), Comp: Eligible', () => {
    const res = parseAndNormalizeQuantity({
      size_text: '900gmx10',
      title_en: 'Dari Chicken 900gm x10',
      title_ar: 'داري دجاج ٩٠٠ جم × ١٠',
      offer_price: 138.99
    });

    expect(res.pack_quantity).toBe(10);
    expect(res.each_size_value).toBe(900);
    expect(res.each_size_unit).toBe('g');
    expect(res.total_content_value).toBe(9000);
    expect(res.standardized_unit).toBe('kilogram');
    expect(res.standardized_total_value).toBe(9);
    expect(res.standardized_unit_price).toBe(15.44); // 138.99 / 9 = 15.44
    expect(res.comparison_eligible).toBe(true);
  });

  it('should parse 155gmx2: pack_quantity 2, each_size_value 155, g, total 310 (0.31kg), Comp: Eligible', () => {
    const res = parseAndNormalizeQuantity({
      size_text: '155gmx2',
      title_en: "Lay's Chips 155gm x2 Assorted",
      title_ar: 'ليز بطاطس متنوعة ١٥٥ جم × ٢',
      offer_price: 11.99
    });

    expect(res.pack_quantity).toBe(2);
    expect(res.each_size_value).toBe(155);
    expect(res.each_size_unit).toBe('g');
    expect(res.total_content_value).toBe(310);
    expect(res.standardized_unit).toBe('kilogram');
    expect(res.standardized_total_value).toBe(0.31);
    expect(res.standardized_unit_price).toBe(38.68); // 11.99 / 0.31 = 38.68
    expect(res.comparison_eligible).toBe(true);
  });

  it('should handle narrow variant range 6x245/250ml (<= 10% diff) as Comp: Eligible', () => {
    const res = parseAndNormalizeQuantity({
      size_text: '6x245/250ml',
      title_en: 'Pepsi / 7Up / Mirinda / Mountain Dew / Shani Bottle (6 x 245/250ml)',
      offer_price: 15.00
    });

    expect(res.pack_quantity).toBe(6);
    expect(res.each_size_value).toBe(247.5);
    expect(res.each_size_unit).toBe('ml');
    expect(res.is_narrow_variant_range).toBe(true);
    expect(res.standardized_unit).toBe('liter');
    expect(res.standardized_total_value).toBe(1.485); // 6 * 247.5 / 1000
    expect(res.standardized_unit_price).toBe(10.10); // 15 / 1.485
    expect(res.comparison_eligible).toBe(true);
  });

  it('should safely exclude wide variant range 117-150gm (> 15% diff)', () => {
    const res = parseAndNormalizeQuantity({
      size_text: '117-150gm',
      title_en: 'Twix/Bounty/Snickers/Mars/Galaxy Miniature 117-150gm',
      offer_price: 14.95
    });

    expect(res.comparison_eligible).toBe(false);
    expect(res.exclusion_reason).toBe('variable_weight_range');
  });

  it('should enforce original_price = null when original_price_box is null', () => {
    const offer: ExtractedOfferRev1 = {
      offer_number: 2,
      arabic_title: 'حبحب',
      english_title: 'Watermelon',
      brand: null,
      is_multi_brand_or_variant: false,
      size_value: '2 Kg',
      unit_type: 'Kg / كيلو',
      promo_price: 5,
      original_price: 5,
      promo_condition: 'STANDARD',
      confidence: 0.99,
      components: {
        product_graphic_box: [485, 360, 615, 620],
        promo_price_box: [580, 530, 640, 630],
        original_price_box: null,
        unit_and_size_badge_box: [470, 355, 520, 425],
        title_text_box: [620, 355, 655, 630]
      }
    };

    const normalized = normalizeExtractedOffer(offer);
    expect(normalized.original_price).toBeNull();
    expect(normalized.promo_price).toBe(5);
    expect(normalized.pack_quantity).toBe(1);
    expect(normalized.each_size_value).toBe(2);
    expect(normalized.each_size_unit).toBe('kg');
  });

  it('should NEVER parse cellular/tech tokens (4G, 5G, 256GB, 65 Inch) as grams and should mark comparison_eligible: false', () => {
    // 4G cellular token (Honor Pad case)
    const res4G = parseAndNormalizeQuantity({
      size_text: '4G',
      title_en: 'Honor X8B Pad',
      title_ar: 'هونر اكس 8 بي',
      offer_price: 899
    });
    expect(res4G.each_size_unit).toBeNull();
    expect(res4G.each_size_value).toBeNull();
    expect(res4G.comparison_eligible).toBe(false);

    // 5G cellular token
    const res5G = parseAndNormalizeQuantity({
      size_text: '5G',
      title_en: 'Galaxy A54 5G',
      offer_price: 1199
    });
    expect(res5G.each_size_unit).toBeNull();
    expect(res5G.comparison_eligible).toBe(false);

    // 256GB storage token
    const res256GB = parseAndNormalizeQuantity({
      size_text: '256GB',
      title_en: 'iPhone 17 Pro Max',
      offer_price: 5549
    });
    expect(res256GB.each_size_unit).toBeNull();
    expect(res256GB.comparison_eligible).toBe(false);

    // 65 Inch TV screen token
    const res65Inch = parseAndNormalizeQuantity({
      size_text: '65 Inch',
      title_en: 'Samsung QLED 4K TV',
      offer_price: 1999
    });
    expect(res65Inch.each_size_unit).toBeNull();
    expect(res65Inch.comparison_eligible).toBe(false);
  });

  it('should accurately classify item_domain for electronics vs grocery items', () => {
    expect(detectItemDomainFromTitle('Honor X8B Pad', 'هونر اكس 8 بي')).toBe('electronics');
    expect(detectItemDomainFromTitle('iPhone 17 Pro Max', 'آيفون 17 برو ماكس')).toBe('electronics');
    expect(detectItemDomainFromTitle('Samsung QLED 4K TV', 'تلفزيون سامسونج')).toBe('electronics');
    expect(detectItemDomainFromTitle('AirPods Pro 3', 'سماعة')).toBe('electronics');
    expect(detectItemDomainFromTitle('Techno Spark GO3', 'تكنو جوال')).toBe('electronics');
    expect(detectItemDomainFromTitle('Samsung Galaxy A26', 'سامسونج جالكسي ايه 26')).toBe('electronics');

    // Food guard
    expect(detectItemDomainFromTitle('Twix/Bounty/Snickers/Mars/Galaxy Miniature 117-150gm', 'شوكولاته')).toBe('grocery');
    expect(detectItemDomainFromTitle('Rana Pasta 400gm', 'رنا مكرونة')).toBe('grocery');
  });
});
