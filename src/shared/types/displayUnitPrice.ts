export type DisplayUnitPriceResult = {
  show_display_unit_price: boolean;

  display_unit_price: number | null;
  display_unit_price_unrounded?: number | null;

  display_unit_basis_value: number | null;
  display_unit_basis_unit:
    | 'g'
    | 'kg'
    | 'ml'
    | 'l'
    | 'piece'
    | 'pieces'
    | null;

  display_unit_family: 'mass' | 'volume' | 'count' | null;

  display_unit_price_label_ar: string | null;
  display_unit_price_label_en: string | null;

  below_min_display_price_threshold: boolean;
  min_display_unit_price_sar: number;

  hidden_reason:
    | 'comparison_not_eligible'
    | 'missing_offer_price'
    | 'missing_total_content'
    | 'unsupported_unit'
    | 'non_grocery_item'
    | 'unsafe_conversion'
    | null;
};
