import { describe, it, expect } from 'vitest';
import { selectDisplayUnitPriceBasis } from '../displayUnitPriceBasis';

describe('selectDisplayUnitPriceBasis', () => {
  it('tuna 185g chooses 100g', () => {
    const result = selectDisplayUnitPriceBasis({
      offerPrice: 6.95,
      totalContentValue: 185,
      totalContentUnit: 'g',
      comparisonEligible: true,
      minDisplayUnitPriceSar: 0.50
    });
    expect(result.show_display_unit_price).toBe(true);
    expect(result.display_unit_basis_value).toBe(100);
    expect(result.display_unit_basis_unit).toBe('g');
    expect(result.display_unit_price).toBe(3.76); // (6.95 * 100) / 185 = 3.756... -> 3.76
    expect(result.display_unit_price_label_en).toBe('SAR 3.76 / 100g');
    expect(result.display_unit_price_label_ar).toBe('3.76 ر.س / 100 جم');
  });

  it('milk 1L chooses 100ml', () => {
    const result = selectDisplayUnitPriceBasis({
      offerPrice: 5,
      totalContentValue: 1000,
      totalContentUnit: 'ml', // equivalent to 1L base
      comparisonEligible: true
    });
    expect(result.show_display_unit_price).toBe(true);
    expect(result.display_unit_basis_value).toBe(100);
    expect(result.display_unit_basis_unit).toBe('ml');
    expect(result.display_unit_price).toBe(0.50);
  });

  it('Fairy 730ml 1+1 chooses 100ml', () => {
    const result = selectDisplayUnitPriceBasis({
      offerPrice: 10,
      totalContentValue: 1460,
      totalContentUnit: 'ml',
      comparisonEligible: true
    });
    expect(result.show_display_unit_price).toBe(true);
    expect(result.display_unit_basis_value).toBe(100);
    expect(result.display_unit_basis_unit).toBe('ml');
    expect(result.display_unit_price).toBe(0.68); // (10 * 100) / 1460 = 0.6849 -> 0.68
  });

  it('rice 10kg chooses 1kg', () => {
    const result = selectDisplayUnitPriceBasis({
      offerPrice: 45,
      totalContentValue: 10,
      totalContentUnit: 'kg',
      comparisonEligible: true
    });
    expect(result.show_display_unit_price).toBe(true);
    expect(result.display_unit_basis_value).toBe(1);
    expect(result.display_unit_basis_unit).toBe('kg');
    expect(result.display_unit_price).toBe(4.50);
  });

  it('30 pieces chooses piece', () => {
    const result = selectDisplayUnitPriceBasis({
      offerPrice: 15,
      totalContentValue: 30,
      totalContentUnit: 'pieces',
      comparisonEligible: true
    });
    expect(result.show_display_unit_price).toBe(true);
    expect(result.display_unit_basis_value).toBe(1);
    expect(result.display_unit_basis_unit).toBe('piece');
    expect(result.display_unit_price).toBe(0.50);
    expect(result.display_unit_price_label_en).toBe('SAR 0.50 / piece');
    expect(result.display_unit_price_label_ar).toBe('0.50 ر.س / قطعة');
  });

  it('100 tissues chooses 10 pieces', () => {
    const result = selectDisplayUnitPriceBasis({
      offerPrice: 10,
      totalContentValue: 100,
      totalContentUnit: 'pieces',
      comparisonEligible: true
    });
    expect(result.show_display_unit_price).toBe(true);
    expect(result.display_unit_basis_value).toBe(10);
    expect(result.display_unit_basis_unit).toBe('pieces');
    expect(result.display_unit_price).toBe(1.00); // 10 / 10 = 1.00
    expect(result.display_unit_price_label_en).toBe('SAR 1.00 / 10 pieces');
    expect(result.display_unit_price_label_ar).toBe('1.00 ر.س / 10 قطع');
  });

  it('comparison_eligible=false hides display unit price', () => {
    const result = selectDisplayUnitPriceBasis({
      offerPrice: 10,
      totalContentValue: 100,
      totalContentUnit: 'g',
      comparisonEligible: false
    });
    expect(result.show_display_unit_price).toBe(false);
    expect(result.hidden_reason).toBe('comparison_not_eligible');
  });

  it('missing total content hides display unit price', () => {
    const result = selectDisplayUnitPriceBasis({
      offerPrice: 10,
      totalContentValue: null,
      totalContentUnit: 'g',
      comparisonEligible: true
    });
    expect(result.show_display_unit_price).toBe(false);
    expect(result.hidden_reason).toBe('missing_total_content');
  });

  it('unsupported unit hides display unit price', () => {
    const result = selectDisplayUnitPriceBasis({
      offerPrice: 10,
      totalContentValue: 100,
      totalContentUnit: 'meters',
      comparisonEligible: true
    });
    expect(result.show_display_unit_price).toBe(false);
    expect(result.hidden_reason).toBe('unsupported_unit');
  });

  it('electronics hides display unit price', () => {
    const result = selectDisplayUnitPriceBasis({
      offerPrice: 100,
      totalContentValue: 1,
      totalContentUnit: 'piece',
      comparisonEligible: true,
      itemDomain: 'electronics'
    });
    expect(result.show_display_unit_price).toBe(false);
    expect(result.hidden_reason).toBe('non_grocery_item');
  });
});
