import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

interface DatasetSelectionRule {
  canonicalSourceId: string
  category: string
  expectedDecisionAutomatic: 'existing' | 'temporary' | 'unresolved'
  expectedDecisionAssisted: 'existing' | 'temporary' | 'unresolved'
  targetCatalogKey: string | null
  distractorType?: string
  overlayAnnotation?: {
    assortment_status?: 'single_sku' | 'multiple_variants'
    quantity_semantics?: 'manufacturer_multipack' | 'retail_promo_quantity'
    manufacturer_pack_count?: number
    promo_purchase_quantity?: number
    notes: string
  }
  duplicateOfCanonicalSourceId?: string
  notes: string
}

const SELECTION_RULES: DatasetSelectionRule[] = [
  // =========================================================================
  // A. EXISTING CATALOG MATCHES (21 Unique Identities + 1 Cross-Retailer Repeat = 22 Offers)
  // =========================================================================
  {
    canonicalSourceId: 'Panda_Test_p001_002',
    category: 'frozen_poultry',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'seara_breast_1800',
    notes: 'Exact 1.8kg == 1800g unit conversion match (Panda)'
  },
  {
    canonicalSourceId: 'Panda_Test_p001_003',
    category: 'dairy_eggs',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'golden_crown_cream_6x155',
    notes: 'Manufacturer 6x155g pack match (Panda)'
  },
  {
    canonicalSourceId: 'Panda_Test_p002_001',
    category: 'dairy_eggs',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'president_mozzarella_900',
    notes: 'Exact 900g match with 450g/200g near-match distractors (Panda)'
  },
  {
    canonicalSourceId: 'Panda_Test_p002_002',
    category: 'frozen_poultry',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'seara_chicken_carton_10x900',
    notes: 'Exact 10x900g manufacturer carton match (Panda)'
  },
  {
    canonicalSourceId: 'Panda_Test_p002_004',
    category: 'dairy_eggs',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'philadelphia_cream_cheese_500',
    notes: 'Exact 500g match with 200g/light near-match distractors (Panda)'
  },
  {
    canonicalSourceId: 'Panda_Test_p003_011',
    category: 'fresh_poultry',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'tanmiah_fresh_1100',
    notes: 'Cross-retailer SKU occurrence #1 (Panda)'
  },
  {
    canonicalSourceId: 'Alwafa_Test_p002_005',
    category: 'fresh_poultry',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'tanmiah_fresh_1100',
    duplicateOfCanonicalSourceId: 'Panda_Test_p003_011',
    notes: 'Cross-retailer SKU occurrence #2 (AlWafa duplicate of Tanmiah 1100g)'
  },
  {
    canonicalSourceId: 'BNDW_Test_p001_001',
    category: 'frozen_poultry',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'sadia_chicken_carton_10x1000',
    notes: '10x1000g carton separated from 1000g single (BinDawood)'
  },
  {
    canonicalSourceId: 'BNDW_Test_p001_002',
    category: 'frozen_poultry',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'sadia_chicken_single_1000',
    notes: '1000g single separated from 10x1000g carton (BinDawood)'
  },
  {
    canonicalSourceId: 'BNDW_Test_p001_004',
    category: 'fresh_poultry',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'entaj_breast_fillet_900',
    notes: 'Entaj 900g fillet (vs 450g Entaj in catalog)'
  },
  {
    canonicalSourceId: 'BNDW_Test_p001_007',
    category: 'dairy_eggs',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'almarai_evap_milk_6x170',
    notes: 'Brand spacing alias "Al Marai" vs "Almarai" (BinDawood)'
  },
  {
    canonicalSourceId: 'Alwafa_Test_p001_013',
    category: 'personal_care_cleaning',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'ever_white_10kg',
    notes: 'Detergent powder 10kg match (AlWafa)'
  },
  {
    canonicalSourceId: 'Alwafa_Test_p002_004',
    category: 'fresh_poultry',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'entaj_drumstick_450',
    notes: 'Cut distinction: Drumstick 450g vs Breast Fillet 450g'
  },
  {
    canonicalSourceId: 'Alwafa_Test_p002_009',
    category: 'fresh_poultry',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'entaj_breast_fillet_450',
    notes: 'Cut distinction: Breast Fillet 450g vs Drumstick 450g'
  },
  {
    canonicalSourceId: 'Lulu_Test_p001_001',
    category: 'staples_pantry',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'alsafeer_rice_5kg',
    notes: 'AlSafeer 5kg rice vs 10kg near-match distractor (LuLu)'
  },
  {
    canonicalSourceId: 'Lulu_Test_p001_002',
    category: 'dairy_eggs',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'al_failaq_eggs_30',
    notes: 'Count-based 30pcs eggs match (LuLu)'
  },
  {
    canonicalSourceId: 'Lulu_Test_p001_003',
    category: 'personal_care_cleaning',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'persil_powder_2_25kg',
    notes: 'Decimal 2.25kg match vs 4.5kg distractor (LuLu)'
  },
  {
    canonicalSourceId: 'Lulu_Test_p002_008',
    category: 'staples_pantry',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'nestle_cornflakes_500g',
    notes: 'Cereal 500g match with 375g distractor (LuLu)'
  },
  {
    canonicalSourceId: 'noori-supermarket-229798534-jeddah_p001_006',
    category: 'dairy_eggs',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'pride_labneh_1kg',
    notes: 'Dairy 1kg labneh match (Noori)'
  },
  {
    canonicalSourceId: 'noori-supermarket-229798534-jeddah_p001_008',
    category: 'personal_care_cleaning',
    expectedDecisionAutomatic: 'existing',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'wafir_detergent_2_5kg',
    notes: 'Detergent 2.5kg match (Noori)'
  },
  {
    canonicalSourceId: 'Alwafa_Test_p001_003',
    category: 'dairy_eggs',
    expectedDecisionAutomatic: 'unresolved',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'nadec_uht_milk_4x1l',
    overlayAnnotation: {
      assortment_status: 'single_sku',
      quantity_semantics: 'manufacturer_multipack',
      manufacturer_pack_count: 4,
      notes: 'Operator confirmed factory 4x1L shrink-wrap multipack from leaflet crop'
    },
    notes: 'Evidence-assisted multipack disambiguation: unannotated=unresolved, assisted=existing'
  },
  {
    canonicalSourceId: 'Lulu_Test_p001_004',
    category: 'frozen_poultry',
    expectedDecisionAutomatic: 'unresolved',
    expectedDecisionAssisted: 'existing',
    targetCatalogKey: 'dari_chicken_10x900',
    overlayAnnotation: {
      assortment_status: 'single_sku',
      quantity_semantics: 'manufacturer_multipack',
      manufacturer_pack_count: 10,
      notes: 'Operator confirmed factory 10x900g carton'
    },
    notes: 'Evidence-assisted carton disambiguation: unannotated=unresolved, assisted=existing'
  },

  // =========================================================================
  // B. GENUINELY NEW / TEMPORARY PRODUCTS (14 Unique Identities)
  // =========================================================================
  {
    canonicalSourceId: 'Panda_Test_p002_003',
    category: 'frozen_poultry',
    expectedDecisionAutomatic: 'temporary',
    expectedDecisionAssisted: 'temporary',
    targetCatalogKey: null,
    distractorType: 'carton_vs_single_promo_qty',
    notes: 'Seara 900g (3x900g promo): must NOT match 10x900g carton or 1000g single'
  },
  {
    canonicalSourceId: 'Panda_Test_p003_013',
    category: 'fresh_poultry',
    expectedDecisionAutomatic: 'unresolved',
    expectedDecisionAssisted: 'unresolved',
    targetCatalogKey: null,
    notes: 'Arabic-only brand Golden Chicken Mixed Parts (mixed-cut assortment abstention)'
  },
  {
    canonicalSourceId: 'noori-supermarket-229798534-jeddah_p001_004',
    category: 'dairy_eggs',
    expectedDecisionAutomatic: 'temporary',
    expectedDecisionAssisted: 'temporary',
    targetCatalogKey: null,
    notes: 'Pearl of Farms Packed Eggs 30pcs (zero-candidate absent brand temporary SKU)'
  },
  {
    canonicalSourceId: 'Panda_Test_p003_014',
    category: 'fresh_poultry',
    expectedDecisionAutomatic: 'temporary',
    expectedDecisionAssisted: 'temporary',
    targetCatalogKey: null,
    notes: 'Arabic-only brand Golden Chicken (الفروج الذهبي) Whole Legs 900g'
  },
  {
    canonicalSourceId: 'BNDW_Test_p001_006',
    category: 'beverages_juices',
    expectedDecisionAutomatic: 'temporary',
    expectedDecisionAssisted: 'temporary',
    targetCatalogKey: null,
    notes: 'Rabea Tea 100 Teabags (absent from seeded Dev catalog)'
  },
  {
    canonicalSourceId: 'Alwafa_Test_p001_009',
    category: 'dairy_eggs',
    expectedDecisionAutomatic: 'temporary',
    expectedDecisionAssisted: 'temporary',
    targetCatalogKey: null,
    notes: 'Al Falah Eggs 30s (absent brand, zero-candidate absence track)'
  },
  {
    canonicalSourceId: 'Alwafa_Test_p002_006',
    category: 'fresh_poultry',
    expectedDecisionAutomatic: 'temporary',
    expectedDecisionAssisted: 'temporary',
    targetCatalogKey: null,
    distractorType: 'near_match_weight_1000_vs_1100',
    notes: 'Tanmiah Fresh Chicken 1000g (near-match distractor against catalog Tanmiah 1100g!)'
  },
  {
    canonicalSourceId: 'Alwafa_Test_p003_014',
    category: 'electronics_household',
    expectedDecisionAutomatic: 'temporary',
    expectedDecisionAssisted: 'temporary',
    targetCatalogKey: null,
    notes: 'Perinna Bed Sheet 225x250cm (non-food piece SKU)'
  },
  {
    canonicalSourceId: 'Lulu_Test_p003_002',
    category: 'snacks_chocolates',
    expectedDecisionAutomatic: 'temporary',
    expectedDecisionAssisted: 'temporary',
    targetCatalogKey: null,
    notes: 'Galaxy Best Of Our Minis 710g (absent chocolate SKU)'
  },
  {
    canonicalSourceId: 'Lulu_Test_p003_003',
    category: 'snacks_chocolates',
    expectedDecisionAutomatic: 'temporary',
    expectedDecisionAssisted: 'temporary',
    targetCatalogKey: null,
    notes: 'Mars Celebration Tub 600g'
  },
  {
    canonicalSourceId: 'BNDW_Test_p004_006',
    category: 'snacks_chocolates',
    expectedDecisionAutomatic: 'temporary',
    expectedDecisionAssisted: 'temporary',
    targetCatalogKey: null,
    notes: 'Cadbury Miniatures 200g'
  },
  {
    canonicalSourceId: 'noori-supermarket-229798534-jeddah_p001_001',
    category: 'staples_pantry',
    expectedDecisionAutomatic: 'temporary',
    expectedDecisionAssisted: 'temporary',
    targetCatalogKey: null,
    notes: 'Bundi Mazza Rice 10kg (zero-candidate offline brand)'
  },
  {
    canonicalSourceId: 'noori-supermarket-229798534-jeddah_p001_002',
    category: 'frozen_poultry',
    expectedDecisionAutomatic: 'temporary',
    expectedDecisionAssisted: 'temporary',
    targetCatalogKey: null,
    notes: 'Fakieh 10x1000g Carton (zero-candidate, must NOT collide with Fakieh 1000g or 600g)'
  },
  {
    canonicalSourceId: 'noori-supermarket-229798534-jeddah_p001_003',
    category: 'frozen_poultry',
    expectedDecisionAutomatic: 'temporary',
    expectedDecisionAssisted: 'temporary',
    targetCatalogKey: null,
    notes: 'Fakieh 1000g Single (zero-candidate, distinct temp ID from Fakieh carton & 600g)'
  },
  {
    canonicalSourceId: 'noori-supermarket-229798534-jeddah_p001_005',
    category: 'staples_pantry',
    expectedDecisionAutomatic: 'temporary',
    expectedDecisionAssisted: 'temporary',
    targetCatalogKey: null,
    notes: 'Fazco Fine Sugar 5kg (zero-candidate absent brand)'
  },

  // =========================================================================
  // C. ASSORTMENT / MULTI-BRAND / MULTI-VARIANT ABSTENTIONS (34 Unique Identities)
  // =========================================================================
  { canonicalSourceId: 'Panda_Test_p001_001', category: 'beverages_juices', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Pepsi/7Up/Mirinda/Dew/Shani multi-brand assortment' },
  { canonicalSourceId: 'Panda_Test_p001_004', category: 'staples_pantry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Al Osra Sugar 5kg Fine/Coarse assortment (raw_extraction_json flagged)' },
  { canonicalSourceId: 'Panda_Test_p001_005', category: 'staples_pantry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Indomie 40x75g/80g mixed flavors' },
  { canonicalSourceId: 'Panda_Test_p001_006', category: 'snacks_chocolates', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Ulker Tea Biscuits / Choco dual product slash' },
  { canonicalSourceId: 'Panda_Test_p001_007', category: 'staples_pantry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Al Khair / Plyms multi-brand tuna' },
  { canonicalSourceId: 'Panda_Test_p001_008', category: 'staples_pantry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Al Arabi / Shams multi-brand cooking oil' },
  { canonicalSourceId: 'Panda_Test_p002_007', category: 'dairy_eggs', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Baskin Robbins 500ml assorted flavors (raw flagged)' },
  { canonicalSourceId: 'Panda_Test_p002_008', category: 'frozen_poultry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Seara Mushab / Burger dual SKU' },
  { canonicalSourceId: 'Panda_Test_p002_009', category: 'beverages_juices', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Sun Top Drink 18x125ml assorted flavors (raw flagged)' },
  { canonicalSourceId: 'Panda_Test_p002_011', category: 'beverages_juices', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Moussy 6x330ml assorted flavors (raw flagged)' },
  { canonicalSourceId: 'Panda_Test_p002_012', category: 'beverages_juices', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Lipton Ice Tea 6x320ml assorted flavors (raw flagged)' },
  { canonicalSourceId: 'Panda_Test_p003_012', category: 'fresh_poultry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Radwa Shawarma Regular/Spicy/Low Fat multi-variant' },
  { canonicalSourceId: 'Panda_Test_p003_015', category: 'fresh_poultry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Tanmiah Marinated Chicken 700g (unspecified marinade + raw flagged)' },
  { canonicalSourceId: 'BNDW_Test_p001_003', category: 'snacks_chocolates', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Nestle Mega Ice Cream 95ml assorted flavors' },
  { canonicalSourceId: 'BNDW_Test_p001_011', category: 'snacks_chocolates', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Lay\'s Chips 110g x2 assorted flavors' },
  { canonicalSourceId: 'BNDW_Test_p004_001', category: 'staples_pantry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Abu Kass Mazza / Amber Basmati Rice 10kg dual SKU' },
  { canonicalSourceId: 'BNDW_Test_p004_002', category: 'staples_pantry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Rana Pasta 400g Penne/Ditalini/Spaghetti spaceless slash' },
  { canonicalSourceId: 'BNDW_Test_p004_003', category: 'personal_care_cleaning', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Sunsilk Shampoo 700ml assorted variants' },
  { canonicalSourceId: 'BNDW_Test_p004_004', category: 'personal_care_cleaning', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Sensodyne Toothpaste 125ml assorted variants' },
  { canonicalSourceId: 'BNDW_Test_p004_007', category: 'personal_care_cleaning', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Comfort Fabric Softener 4L assorted variants' },
  { canonicalSourceId: 'BNDW_Test_p004_011', category: 'personal_care_cleaning', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Tide Detergent Powder 4kg assorted variants' },
  { canonicalSourceId: 'BNDW_Test_p004_012', category: 'personal_care_cleaning', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Persil Detergent Gel 5L assorted variants' },
  { canonicalSourceId: 'Alwafa_Test_p001_001', category: 'staples_pantry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Taj Al-Hind / Taj Mahal multi-brand rice' },
  { canonicalSourceId: 'Alwafa_Test_p001_004', category: 'beverages_juices', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Oska / Arwa multi-brand water' },
  { canonicalSourceId: 'Alwafa_Test_p001_011', category: 'personal_care_cleaning', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'L\'Oreal / Garnier Shampoo 400ml Assorted' },
  { canonicalSourceId: 'Alwafa_Test_p001_012', category: 'personal_care_cleaning', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Dove Soap 125g 5+1 Assorted' },
  { canonicalSourceId: 'Alwafa_Test_p002_008', category: 'fresh_poultry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Tanmiah Fresh Chicken Liver/Gizzard/Heart multi-SKU' },
  { canonicalSourceId: 'Lulu_Test_p002_003', category: 'snacks_chocolates', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Crispy Potato Chips Cheese/Chilli Lime/Hot Sauce' },
  { canonicalSourceId: 'Lulu_Test_p003_007', category: 'snacks_chocolates', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'M&M\'s Milk/Crispy/Peanut Pouch assortment (single ampersand brand preserved)' },
  { canonicalSourceId: 'Lulu_Test_p003_008', category: 'snacks_chocolates', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Galaxy Minis Smooth/Hazelnut/Caramel/CookieCrumble' },
  { canonicalSourceId: 'Lulu_Test_p003_009', category: 'pet_food', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Kitekat Mackerel/Tuna 1.4kg' },
  { canonicalSourceId: 'Lulu_Test_p003_010', category: 'pet_food', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Sheba CatFood Soup 160gm Assorted' },
  { canonicalSourceId: 'Lulu_Test_p003_011', category: 'pet_food', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Whiskas CatFood 1.1Kg/1.2kg Assorted' },
  {
    canonicalSourceId: 'othaim-week24_001_001',
    category: 'frozen_poultry',
    expectedDecisionAutomatic: 'unresolved',
    expectedDecisionAssisted: 'unresolved',
    targetCatalogKey: null,
    overlayAnnotation: {
      assortment_status: 'multiple_variants',
      notes: 'Crop image confirms assorted Sadia Nuggets & Mini Chef variants despite omitted legacy flag'
    },
    notes: 'Critical evidence-overlay assortment test case (Othaim_week24)'
  },

  // =========================================================================
  // D. UNBRANDED COMMODITIES, PRODUCE, SEAFOOD & BAKERY (11 Unique Identities + 1 Repeat)
  // =========================================================================
  { canonicalSourceId: 'Panda_Test_p003_001', category: 'seafood_produce_bakery', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Unbranded Fish Fillet Per Kg' },
  { canonicalSourceId: 'Panda_Test_p003_004', category: 'seafood_produce_bakery', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Chilled Norway Salmon' },
  { canonicalSourceId: 'BNDW_Test_p001_005', category: 'seafood_produce_bakery', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Unbranded Tomato / Kg (unit slash)' },
  { canonicalSourceId: 'BNDW_Test_p001_008', category: 'seafood_produce_bakery', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Salmon Fillet / Kg' },
  { canonicalSourceId: 'BNDW_Test_p001_009', category: 'seafood_produce_bakery', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Garlic / Bag' },
  { canonicalSourceId: 'BNDW_Test_p001_012', category: 'seafood_produce_bakery', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Veal Meat / Kg occurrence #1' },
  { canonicalSourceId: 'BNDW_Test_p001_013', category: 'seafood_produce_bakery', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, duplicateOfCanonicalSourceId: 'BNDW_Test_p001_012', notes: 'Veal Meat / Kg occurrence #2 (cut/tier variant on same page)' },
  { canonicalSourceId: 'BNDW_Test_p001_014', category: 'seafood_produce_bakery', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Cucumber / Kg' },
  { canonicalSourceId: 'BNDW_Test_p002_006', category: 'seafood_produce_bakery', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'In-store bakery Managesh Akawi Cheese (unbranded)' },
  { canonicalSourceId: 'Alwafa_Test_p001_005', category: 'seafood_produce_bakery', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'King Fish Small Per Kg' },
  { canonicalSourceId: 'Alwafa_Test_p001_006', category: 'seafood_produce_bakery', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Mango Keitt Per Kg' },
  { canonicalSourceId: 'Alwafa_Test_p001_008', category: 'seafood_produce_bakery', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Walnut Per Kg' },

  // =========================================================================
  // E. INCOMPLETE ATTRIBUTES, AMBIGUOUS PACKAGING, ELECTRONICS & LEGACY GAPS (20 Unique + 3 Repeats = 23 Offers)
  // =========================================================================
  { canonicalSourceId: 'BNDW_Test_p001_010', category: 'staples_pantry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Noor Canola Oil 1.5Ltr (x2): ambiguous pack vs retail buy-2 without overlay' },
  { canonicalSourceId: 'Alwafa_Test_p001_007', category: 'frozen_poultry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'temporary', targetCatalogKey: null, overlayAnnotation: { assortment_status: 'single_sku', quantity_semantics: 'retail_promo_quantity', promo_purchase_quantity: 2, manufacturer_pack_count: 1, notes: 'Retail 2-bag promo of Fakieh Frozen Chicken 600g single' }, notes: 'Evidence-assisted retail promo disambiguation: unannotated=unresolved, assisted=temporary' },
  { canonicalSourceId: 'BNDW_Test_p004_009', category: 'staples_pantry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Albayt White Sugar 1Kg (x3): ambiguous 3-bag promo vs multipack' },
  { canonicalSourceId: 'BNDW_Test_p004_010', category: 'staples_pantry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Geisha Light Meat Tuna 185gm (x2): ambiguous qty semantics' },
  { canonicalSourceId: 'noori-supermarket-229798534-jeddah_p001_007', category: 'staples_pantry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Qoot & Root Flour 1kg x9 (amp single brand preserved; qty semantics ambiguous)' },
  { canonicalSourceId: 'Lulu_Test_p002_004', category: 'snacks_chocolates', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'existing', targetCatalogKey: 'al_batal_chips_12x23', overlayAnnotation: { assortment_status: 'single_sku', quantity_semantics: 'manufacturer_multipack', manufacturer_pack_count: 12, notes: 'Confirmed 12x23g carton box' }, notes: 'Evidence-assisted carton disambiguation (LuLu)' },
  { canonicalSourceId: 'Lulu_Test_p002_011', category: 'snacks_chocolates', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'existing', targetCatalogKey: 'tiffany_butter_cookies_12x40', overlayAnnotation: { assortment_status: 'single_sku', quantity_semantics: 'manufacturer_multipack', manufacturer_pack_count: 12, notes: 'Confirmed 12x40g carton box' }, notes: 'Evidence-assisted box disambiguation (LuLu)' },
  { canonicalSourceId: 'noori-supermarket-229798534-jeddah_p001_009', category: 'personal_care_cleaning', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Softy Facial Tissues 10x130 Sheets (sheet unit ambiguous)' },
  { canonicalSourceId: 'BNDW_Test_p004_008', category: 'personal_care_cleaning', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'City Facial Tissue 10x150 (sheets unit ambiguous)' },
  { canonicalSourceId: 'BNDW_Test_p002_002', category: 'seafood_produce_bakery', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Snickers Cake missing weight/size' },
  { canonicalSourceId: 'BNDW_Test_p003_001', category: 'electronics_household', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Samsung QLED 4K TV missing size/model code #1' },
  { canonicalSourceId: 'BNDW_Test_p003_002', category: 'electronics_household', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, duplicateOfCanonicalSourceId: 'BNDW_Test_p003_001', notes: 'Samsung QLED 4K TV size variant #2 (shared generic title)' },
  { canonicalSourceId: 'BNDW_Test_p003_004', category: 'electronics_household', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'LG QNED 4K Smart TV missing model/inch' },
  { canonicalSourceId: 'BNDW_Test_p003_008', category: 'electronics_household', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'iPhone 17 Pro Max missing storage variant (GB)' },
  { canonicalSourceId: 'BNDW_Test_p003_010', category: 'electronics_household', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Honor X8B Pad #1' },
  { canonicalSourceId: 'BNDW_Test_p003_011', category: 'electronics_household', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, duplicateOfCanonicalSourceId: 'BNDW_Test_p003_010', notes: 'Honor X8B Pad #2' },
  { canonicalSourceId: 'dukan-849797163-jeddah_p009_001', category: 'electronics_household', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'CHiQ 55-inch TV missing unit/packaging schema' },
  { canonicalSourceId: 'othaim-week24_001_005', category: 'staples_pantry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Legacy Othaim flat JSON missing numeric each_size_value (KDD Tomato Paste gx8)' },
  { canonicalSourceId: 'othaim-week24_001_008', category: 'dairy_eggs', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Legacy Othaim flat JSON missing structured each_size (Almarai Butter 100gx3)' },
  { canonicalSourceId: 'othaim-week24_001_009', category: 'staples_pantry', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Legacy Othaim incomplete record missing both product name & unit size' },
  { canonicalSourceId: 'othaim-week24_002_001', category: 'beverages_juices', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Legacy Othaim Coca Cola Can 320mlx24 occurrence #1 (null brand field in JSON)' },
  { canonicalSourceId: 'othaim-week24_002_003', category: 'beverages_juices', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, duplicateOfCanonicalSourceId: 'othaim-week24_002_001', notes: 'Legacy Othaim Coca Cola Can 320mlx24 occurrence #2' },
  { canonicalSourceId: 'othaim-week24_006_004', category: 'snacks_chocolates', expectedDecisionAutomatic: 'unresolved', expectedDecisionAssisted: 'unresolved', targetCatalogKey: null, notes: 'Legacy Othaim Godiva Masterpieces Bar 32gx5 (incomplete legacy unit extraction)' }
]

function main(): void {
  const auditPath = join(process.cwd(), 'Extracts', 'audit_003_pipeline_190_records.json')
  const audit = JSON.parse(readFileSync(auditPath, 'utf8'))
  const byId = new Map<string, any>()
  for (const r of audit.records) {
    byId.set(r.canonicalSourceId, r)
  }

  const seenOfferIds = new Set<string>()
  const offers: any[] = []
  const overlayAnnotations: Record<string, any> = {}

  for (const rule of SELECTION_RULES) {
    if (seenOfferIds.has(rule.canonicalSourceId)) {
      throw new Error(`Duplicate canonicalSourceId in SELECTION_RULES: ${rule.canonicalSourceId}`)
    }
    seenOfferIds.add(rule.canonicalSourceId)

    const audited = byId.get(rule.canonicalSourceId)
    if (!audited) {
      throw new Error(`Missing audited record for canonicalSourceId: ${rule.canonicalSourceId}`)
    }

    const invAll = JSON.parse(readFileSync(join(process.cwd(), 'Extracts', 'audit_003_local_extractions_inventory.json'), 'utf8'))
    const invRec = invAll.allRecords.find((x: any) => x.canonicalSourceId === rule.canonicalSourceId)
    const rawData = JSON.parse(readFileSync(invRec.filePath, 'utf8'))

    if (rule.overlayAnnotation) {
      const nowIso = new Date().toISOString()
      overlayAnnotations[rule.canonicalSourceId] = {
        source_id: rule.canonicalSourceId,
        evidence_source: 'operator_verified_card',
        identity_resolution: rule.overlayAnnotation.assortment_status === 'single_sku' ? 'eligible' : 'requires_review',
        created_at: nowIso,
        updated_at: nowIso,
        reversible: true,
        ...rule.overlayAnnotation
      }
    }

    offers.push({
      canonicalSourceId: rule.canonicalSourceId,
      sourceOfferId: audited.canonicalSourceId,
      retailer: audited.retailer,
      workspace: audited.workspace,
      category: rule.category,
      sourceFilePath: invRec.filePath.replace(process.cwd() + '\\', '').replace(/\\/g, '/'),
      cropPath: audited.cropPath,
      titleEn: audited.titleEn,
      titleAr: audited.titleAr,
      brandRaw: audited.brandRaw,
      brandKey: audited.brandKey,
      brandStatus: audited.brandStatus,
      brandEn: audited.brandNameEn,
      brandAr: audited.brandNameAr,
      variantOrFlavor: rawData.product?.variant_or_flavor || rawData.product?.variant || null,
      sizeOrWeight: audited.sizeOrWeight,
      eachSizeValue: audited.eachSizeValue,
      eachSizeUnit: audited.eachSizeUnit,
      manufacturerPackCount: audited.manufacturerPackCount,
      promoConditionQuantity: audited.promoConditionQuantity,
      saleUnitType: rawData.content?.sale_unit_type || null,
      quantitySemantics: audited.quantitySemantics,
      assortmentStateCategory: audited.assortmentStateCategory,
      recordedAssortmentStatus: audited.recordedAssortmentStatus,
      rawIsMultiBrandOrVariant: audited.rawIsMultiBrandOrVariant,
      preservedConfidence: audited.preservedConfidence,
      missingFields: audited.missingFields,
      expectedDecisionAutomatic: rule.expectedDecisionAutomatic,
      expectedDecisionAssisted: rule.expectedDecisionAssisted,
      targetCatalogKey: rule.targetCatalogKey,
      distractorType: rule.distractorType || null,
      requiresEvidenceOverlay: Boolean(rule.overlayAnnotation),
      duplicateOfCanonicalSourceId: rule.duplicateOfCanonicalSourceId || null,
      notes: rule.notes
    })
  }

  const uniqueIdentityOffers = offers.filter((o) => !o.duplicateOfCanonicalSourceId)
  const repeatOffers = offers.filter((o) => Boolean(o.duplicateOfCanonicalSourceId))

  const categoryCounts: Record<string, number> = {}
  const retailerCounts: Record<string, number> = {}
  for (const o of uniqueIdentityOffers) {
    categoryCounts[o.category] = (categoryCounts[o.category] || 0) + 1
  }
  for (const o of offers) {
    retailerCounts[o.retailer] = (retailerCounts[o.retailer] || 0) + 1
  }

  const outDir = join(process.cwd(), 'test-fixtures', 'matching-benchmarks')
  mkdirSync(outDir, { recursive: true })

  const dataset = {
    schemaVersion: '1.0',
    milestone: 'WIFRAN-EXTRACTOR-CATALOG-MATCH-003',
    generatedAt: new Date().toISOString(),
    provenanceNote: '100% genuine local extracted supermarket records across 7 retailers; 0 fabricated offers.',
    counts: {
      totalExtractedOffers: offers.length,
      deduplicatedUniqueIdentities: uniqueIdentityOffers.length,
      repeatedMultiOccurrenceOffers: repeatOffers.length,
      automaticGoldBreakdown: {
        existing: uniqueIdentityOffers.filter((o) => o.expectedDecisionAutomatic === 'existing').length,
        temporary: uniqueIdentityOffers.filter((o) => o.expectedDecisionAutomatic === 'temporary').length,
        unresolved: uniqueIdentityOffers.filter((o) => o.expectedDecisionAutomatic === 'unresolved').length
      },
      evidenceAssistedGoldBreakdown: {
        existing: uniqueIdentityOffers.filter((o) => o.expectedDecisionAssisted === 'existing').length,
        temporary: uniqueIdentityOffers.filter((o) => o.expectedDecisionAssisted === 'temporary').length,
        unresolved: uniqueIdentityOffers.filter((o) => o.expectedDecisionAssisted === 'unresolved').length
      },
      overlayRequiredIdentitiesCount: uniqueIdentityOffers.filter((o) => o.requiresEvidenceOverlay).length,
      categoryCounts,
      retailerOfferCounts: retailerCounts
    },
    items: offers
  }

  const dsPath = join(outDir, 'real_world_100_dataset_v1.json')
  const ovPath = join(outDir, 'real_world_100_evidence_overlay.json')
  writeFileSync(dsPath, JSON.stringify(dataset, null, 2), 'utf8')
  writeFileSync(
    ovPath,
    JSON.stringify({ schemaVersion: '1.0', milestone: 'WIFRAN-EXTRACTOR-CATALOG-MATCH-003', annotations: overlayAnnotations }, null, 2),
    'utf8'
  )

  console.log(`Built ${dsPath}`)
  console.log(JSON.stringify(dataset.counts, null, 2))
}

main()

