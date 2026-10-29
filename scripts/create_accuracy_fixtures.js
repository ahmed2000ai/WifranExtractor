const fs = require('fs');
const path = require('path');

const fixturesDir = path.join(__dirname, '../src/shared/fixtures/accuracy');
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

const fixtures = [
  {
    name: 'oil-1-5l-not-price',
    description: '1.5L must be content size, not offer price',
    raw_ocr_json: {
      offer_price: 1.5,
      currency: "SAR",
      size_text: "1.5L"
    },
    expected: {
      blocking_error_codes: ['size_misclassified_as_price'],
      warning_codes: [],
      comparison_eligible: false,
      publish_decision: 'skip_or_quarantine'
    }
  },
  {
    name: 'fairy-730ml-1-plus-1',
    description: '730ml 1+1 bundle quantity correctly parsed',
    raw_ocr_json: {
      offer_price: 25,
      currency: "SAR",
      size_text: "730ml",
      promotion_mechanic: "1+1"
    },
    expected: {
      blocking_error_codes: [],
      warning_codes: [],
      comparison_eligible: true,
      publish_decision: 'publish'
    }
  },
  {
    name: 'pack-8x135g',
    description: '8 x 135g pack',
    raw_ocr_json: {
      offer_price: 12,
      currency: "SAR",
      size_text: "8x135g",
      pack_quantity: 8
    },
    expected: {
      blocking_error_codes: [],
      warning_codes: [],
      comparison_eligible: true,
      publish_decision: 'publish'
    }
  },
  {
    name: 'watermelon-per-2kg',
    description: 'Watermelon per 2kg',
    raw_ocr_json: {
      offer_price: 10,
      currency: "SAR",
      size_text: "per 2kg",
      price_basis: "per_2kg"
    },
    expected: {
      blocking_error_codes: [],
      warning_codes: [],
      comparison_eligible: true,
      publish_decision: 'publish'
    }
  },
  {
    name: 'tv-electronics-non-grocery',
    description: 'TV electronics domain',
    raw_ocr_json: {
      title_en: "Samsung TV 55 inch",
      item_domain: "electronics",
      offer_price: 1500,
      currency: "SAR",
      size_text: "55 inch"
    },
    expected: {
      blocking_error_codes: [],
      warning_codes: [],
      comparison_eligible: false,
      publish_decision: 'publish_but_exclude_from_comparison'
    }
  },
  {
    name: 'old-price-not-current-price',
    description: 'Old price classified as offer price blocks',
    raw_ocr_json: {
      offer_price: 35,
      original_price: 35,
      currency: "SAR"
    },
    expected: {
      blocking_error_codes: ['original_price_misclassified_as_offer_price'],
      warning_codes: [],
      comparison_eligible: false,
      publish_decision: 'skip_or_quarantine'
    }
  },
  {
    name: 'missing-offer-price',
    description: 'Missing offer price blocks',
    raw_ocr_json: {
      title_en: "Product with no price",
      currency: "SAR"
    },
    expected: {
      blocking_error_codes: ['missing_offer_price'],
      warning_codes: [],
      comparison_eligible: false,
      publish_decision: 'skip_or_quarantine'
    }
  },
  {
    name: 'unclear-pack-size-publish-but-exclude',
    description: 'Unclear pack size excludes from comparison',
    raw_ocr_json: {
      title_en: "Some product pack",
      offer_price: 10,
      currency: "SAR",
      size_text: "1 pack"
    },
    expected: {
      blocking_error_codes: [],
      warning_codes: ['unclear_pack_size'],
      comparison_eligible: false,
      publish_decision: 'publish_but_exclude_from_comparison'
    }
  },
  {
    name: 'valid-comparable-liter-offer',
    description: 'Valid comparable liter offer',
    raw_ocr_json: {
      title_en: "Milk",
      offer_price: 5,
      currency: "SAR",
      size_text: "1L"
    },
    expected: {
      blocking_error_codes: [],
      warning_codes: [],
      comparison_eligible: true,
      publish_decision: 'publish'
    }
  },
  {
    name: 'valid-non-comparable-display-offer',
    description: 'Valid non-comparable display offer',
    raw_ocr_json: {
      title_en: "Assorted toys",
      offer_price: 15,
      currency: "SAR",
      size_text: null
    },
    expected: {
      blocking_error_codes: [],
      warning_codes: ['missing_size'],
      comparison_eligible: false,
      publish_decision: 'publish_but_exclude_from_comparison'
    }
  }
];

for (const fixture of fixtures) {
  const filePath = path.join(fixturesDir, `${fixture.name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2), 'utf8');
}
console.log('Fixtures generated successfully.');
