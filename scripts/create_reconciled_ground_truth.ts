import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const cwd = process.cwd();
const outDir = join(cwd, 'temp/reconciliation_opt004c_r1');

export interface VerifiedGroundTruthOffer {
  offer_number: number;
  arabic_title: string;
  english_title: string;
  brand: string | null;
  brand_reasoning: string;
  promo_price: number;
  original_price: number | null;
  size_value: string | null;
  unit_type: string | null;
  pack_quantity: number;
  each_size_value: number | null;
  each_size_unit: string | null;
  is_multi_brand_or_variant: boolean;
  components: {
    product_graphic_box: number[];
    promo_price_box: number[];
    title_text_box: number[];
    original_price_box: number[] | null;
    unit_and_size_badge_box: number[] | null;
  };
  provenance: {
    verification_status: 'human_verified_source_image';
    source_image: string;
    historical_fixture_discrepancy?: string;
  };
}

export function createReconciledGroundTruth() {
  console.log('Building fully verified ground truth reference for GOLDEN-P1...');

  // Exact coordinates derived from source image page1_small.png (827x1170)
  const goldenP1Offers: VerifiedGroundTruthOffer[] = [
    {
      offer_number: 1,
      arabic_title: 'ساديا ناجتس دجاج ميني شيف 270 جرام',
      english_title: 'Sadia Nuggets Chicken Mini Chef 270g',
      brand: 'Sadia',
      brand_reasoning: 'Manufacturer brand clearly visible on commercial packaging',
      promo_price: 5,
      original_price: 11.25,
      size_value: '270g',
      unit_type: 'Each / للحبة',
      pack_quantity: 1,
      each_size_value: 270,
      each_size_unit: 'g',
      is_multi_brand_or_variant: false,
      components: {
        product_graphic_box: [498, 41, 595, 327],
        promo_price_box: [545, 270, 622, 332],
        title_text_box: [594, 34, 625, 202],
        original_price_box: [544, 277, 558, 326],
        unit_and_size_badge_box: [482, 38, 517, 149]
      },
      provenance: {
        verification_status: 'human_verified_source_image',
        source_image: 'test-fixtures/page1_small.png'
      }
    },
    {
      offer_number: 2,
      arabic_title: 'حبحب',
      english_title: 'Watermelon',
      brand: null,
      brand_reasoning: 'Fresh unbranded produce sold by weight; brand is null',
      promo_price: 5,
      original_price: null,
      size_value: '2 Kg',
      unit_type: 'Kg / كيلو',
      pack_quantity: 1,
      each_size_value: 2,
      each_size_unit: 'kg',
      is_multi_brand_or_variant: false,
      components: {
        product_graphic_box: [491, 353, 610, 646],
        promo_price_box: [557, 587, 623, 647],
        title_text_box: [612, 352, 625, 520],
        original_price_box: null,
        unit_and_size_badge_box: [482, 354, 517, 404]
      },
      provenance: {
        verification_status: 'human_verified_source_image',
        source_image: 'test-fixtures/page1_small.png'
      }
    },
    {
      offer_number: 3,
      arabic_title: 'بصل أحمر',
      english_title: 'Red Onion',
      brand: null,
      brand_reasoning: 'Fresh unbranded produce sold by weight; brand is null',
      promo_price: 5,
      original_price: null,
      size_value: '2 Kg',
      unit_type: 'Kg / كيلو',
      pack_quantity: 1,
      each_size_value: 2,
      each_size_unit: 'kg',
      is_multi_brand_or_variant: false,
      components: {
        product_graphic_box: [474, 668, 612, 963],
        promo_price_box: [557, 902, 623, 964],
        title_text_box: [611, 670, 625, 839],
        original_price_box: null,
        unit_and_size_badge_box: [482, 671, 518, 720]
      },
      provenance: {
        verification_status: 'human_verified_source_image',
        source_image: 'test-fixtures/page1_small.png'
      }
    },
    {
      offer_number: 4,
      arabic_title: 'زيت هالي نخيل',
      english_title: 'Haley Olein Oil',
      brand: 'Haley',
      brand_reasoning: 'Manufacturer private label Haley printed on cooking oil bottle',
      promo_price: 10,
      original_price: 15.99,
      size_value: '1.5L',
      unit_type: 'Each / للحبة',
      pack_quantity: 1,
      each_size_value: 1.5,
      each_size_unit: 'l',
      is_multi_brand_or_variant: false,
      components: {
        product_graphic_box: [641, 131, 782, 222],
        promo_price_box: [716, 248, 782, 331],
        title_text_box: [638, 260, 703, 331],
        original_price_box: [702, 278, 716, 329],
        unit_and_size_badge_box: [641, 38, 675, 129]
      },
      provenance: {
        verification_status: 'human_verified_source_image',
        source_image: 'test-fixtures/page1_small.png',
        historical_fixture_discrepancy: 'Historical page1_golden.json erroneously listed "Abu Fahad Fine Sugar 5kg @ 10 SAR" with synthetic grid box [665, 45, 795, 295]. Source image is Haley Olein Oil 1.5L bottle.'
      }
    },
    {
      offer_number: 5,
      arabic_title: 'معجون طماطم كي دي دي',
      english_title: 'KDD Tomato Paste',
      brand: 'KDD',
      brand_reasoning: 'Manufacturer brand KDD clearly printed on tomato paste pack',
      promo_price: 10,
      original_price: 14.25,
      size_value: '8x135g',
      unit_type: 'Per Pack / للربطة',
      pack_quantity: 8,
      each_size_value: 135,
      each_size_unit: 'g',
      is_multi_brand_or_variant: false,
      components: {
        product_graphic_box: [641, 380, 748, 608],
        promo_price_box: [716, 563, 783, 648],
        title_text_box: [754, 351, 784, 529],
        original_price_box: [703, 597, 717, 646],
        unit_and_size_badge_box: [642, 354, 674, 467]
      },
      provenance: {
        verification_status: 'human_verified_source_image',
        source_image: 'test-fixtures/page1_small.png'
      }
    },
    {
      offer_number: 6,
      arabic_title: 'صابون غسيل الأطباق من فيري',
      english_title: 'Fairy 5X Power Action',
      brand: 'Fairy',
      brand_reasoning: 'Procter & Gamble Fairy dishwashing liquid bottle clearly shown',
      promo_price: 10,
      original_price: 21.99,
      size_value: '730ml',
      unit_type: 'Each / للحبة',
      pack_quantity: 1,
      each_size_value: 730,
      each_size_unit: 'ml',
      is_multi_brand_or_variant: false,
      components: {
        product_graphic_box: [642, 702, 777, 856],
        promo_price_box: [716, 881, 782, 963],
        title_text_box: [642, 854, 705, 963],
        original_price_box: [702, 913, 717, 963],
        unit_and_size_badge_box: [641, 671, 674, 781]
      },
      provenance: {
        verification_status: 'human_verified_source_image',
        source_image: 'test-fixtures/page1_small.png',
        historical_fixture_discrepancy: 'Historical page1_golden.json erroneously listed "Haly Sella Basmati Rice 5kg @ 15 SAR". Corrected to Fairy 730ml in OPT-003 Canary.'
      }
    },
    {
      offer_number: 7,
      arabic_title: 'بيض بروتين اليوم/الروابي/الفيلق',
      english_title: 'Protein Alyoum/Al Rawabi Alfailaq Eggs',
      brand: 'Alyoum / Al Rawabi / Alfailaq',
      brand_reasoning: 'Multi-brand egg offer grouping 3 producer brands',
      promo_price: 15,
      original_price: 22.50,
      size_value: '30PCS',
      unit_type: 'Per Plate / للطبق',
      pack_quantity: 1,
      each_size_value: 30,
      each_size_unit: 'pcs',
      is_multi_brand_or_variant: true,
      components: {
        product_graphic_box: [798, 82, 912, 321],
        promo_price_box: [875, 252, 941, 332],
        title_text_box: [910, 24, 948, 339],
        original_price_box: [861, 278, 875, 328],
        unit_and_size_badge_box: [801, 38, 833, 149]
      },
      provenance: {
        verification_status: 'human_verified_source_image',
        source_image: 'test-fixtures/page1_small.png',
        historical_fixture_discrepancy: 'Historical page1_golden.json listed brands "Rahima / Khazna / Ghadeer / Bayad". Source image shows "Alyoum / Al Rawabi / Alfailaq".'
      }
    },
    {
      offer_number: 8,
      arabic_title: 'زبدة المراعي غير مملحة',
      english_title: 'Al Marai Unsalted Butter',
      brand: 'Al Marai',
      brand_reasoning: 'Almarai logo and packaging clearly visible',
      promo_price: 15,
      original_price: 22.99,
      size_value: '3x100g',
      unit_type: 'Per Pack / للربطة',
      pack_quantity: 3,
      each_size_value: 100,
      each_size_unit: 'g',
      is_multi_brand_or_variant: false,
      components: {
        product_graphic_box: [801, 429, 913, 552],
        promo_price_box: [875, 568, 941, 648],
        title_text_box: [911, 342, 948, 654],
        original_price_box: [860, 596, 875, 646],
        unit_and_size_badge_box: [801, 354, 833, 497]
      },
      provenance: {
        verification_status: 'human_verified_source_image',
        source_image: 'test-fixtures/page1_small.png',
        historical_fixture_discrepancy: 'Historical page1_golden.json erroneously listed "Sunny Cooking Oil 1.5L @ 15 SAR". Source image is Almarai Unsalted Butter 3x100g.'
      }
    },
    {
      offer_number: 9,
      arabic_title: 'مرقة ماجي دجاج',
      english_title: 'Maggi Stock Chicken',
      brand: 'Maggi',
      brand_reasoning: 'Nestle Maggi brand printed on yellow chicken bouillon box',
      promo_price: 15,
      original_price: 22.99,
      size_value: '16x18g',
      unit_type: 'Per Pack / للربطة',
      pack_quantity: 16,
      each_size_value: 18,
      each_size_unit: 'g',
      is_multi_brand_or_variant: false,
      components: {
        product_graphic_box: [801, 755, 910, 888],
        promo_price_box: [874, 884, 941, 963],
        title_text_box: [910, 659, 948, 977],
        original_price_box: [860, 913, 875, 963],
        unit_and_size_badge_box: [801, 672, 832, 781]
      },
      provenance: {
        verification_status: 'human_verified_source_image',
        source_image: 'test-fixtures/page1_small.png',
        historical_fixture_discrepancy: 'Historical page1_golden.json erroneously listed "Lipton Loose Tea 400g @ 15 SAR". Source image is Maggi Chicken Stock 16x18g.'
      }
    }
  ];

  const gtPath = join(outDir, 'golden_p1_reconciled_ground_truth.json');
  writeFileSync(gtPath, JSON.stringify({ offers: goldenP1Offers }, null, 2), 'utf8');
  console.log(`Reconciled GOLDEN-P1 ground truth written to: ${gtPath}`);
}

createReconciledGroundTruth();

