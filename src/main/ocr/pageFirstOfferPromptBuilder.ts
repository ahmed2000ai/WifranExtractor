export function buildPageFirstOfferPrompt(): string {
  return `You are analyzing one complete rendered page from a Saudi supermarket promotional leaflet.

Return strict JSON conforming exactly to the supplied schema.

Your primary requirement is completeness:
identify every independent product offer visible on this page.

Scan the page systematically:
top to bottom,
left to right,
including large hero offers,
small side offers,
top and bottom rows,
irregular offer panels,
and products placed on continuous shared backgrounds.

Offer grouping rules:

1. Create one offer entry for each independent current-offer price anchor.

2. If one visual region contains five separate current prices for five products,
   return five offer entries, not one grouped entry.

3. If several product variants share one current price and are clearly one offer,
   return one offer entry and place the variants in variant_names.

4. If several products form one bundle with one shared price,
   return one bundle offer.

5. A smaller crossed-out or old price is not a separate offer.
   Classify it as original_old_price.

6. Product size and content values are not prices:
   1.5L, 730ml, 10kg, 8×135g, 30PCS, inch measurements,
   4K, HD, FHD, UHD and similar product attributes must not be
   selected as current offer prices.

7. Discount percentages, loyalty points and product quantities
   are not current offer prices unless the page explicitly displays
   them as a payable price.

8. Every selected current offer price must be supported by exact visible evidence text.

9. Preserve the exact visible evidence text for:
   title,
   current price,
   original price,
   size/content,
   and promotion condition.

10. Do not add supermarket, location, leaflet filename or date metadata.
    Those values come from trusted application context.

11. Do not invent missing values.
    Use null and add a warning when unclear.

Before returning:
- count the independent current-price anchors;
- verify that every independent current-price anchor is represented;
- verify that no one offer contains several unrelated current-price anchors;
- scan all page edges and corners;
- set final_completeness_check_performed=true only after completing this audit.

Return JSON only.`;
}

export type PageFirstRetryDiagnostics = {
  firstPassOfferCount: number;
  independentAnchorCount: number;
  uncoveredAnchorCount: number;
  offersMissingPriceLinkCount: number;
  suspiciousRegions: string[];
};

export function buildPageFirstRetryPrompt(diagnostics: PageFirstRetryDiagnostics): string {
  const regionsList = diagnostics.suspiciousRegions.length > 0
    ? diagnostics.suspiciousRegions.join(', ')
    : 'uncovered or dense regions';

  return `This is a second completeness audit of the same full leaflet page.

The first pass returned ${diagnostics.firstPassOfferCount} offers.
Local evidence analysis found:
- ${diagnostics.independentAnchorCount} independent current-price anchors
- ${diagnostics.uncoveredAnchorCount} uncovered anchors
- ${diagnostics.offersMissingPriceLinkCount} offers without matched current-price evidence
- the following approximate page regions may contain missed offers: ${regionsList}

Re-examine the entire page.

Return every independent offer using the same strict schema.

Pay special attention to:
- all uncovered price-anchor regions;
- side offers around large hero products;
- products sharing one continuous background;
- small top and bottom row offers;
- offers whose old price is visually close to the current price.

Do not preserve a first-pass grouping if it combines several independent prices.

Return a complete corrected page result.`;
}

export function buildPageFirstAnnotationFormat(): Record<string, unknown> {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'page_first_offer_extraction',
      strict: true,
      schema: {
        type: 'object',
        required: [
          'schema_version',
          'page_number',
          'page_classification',
          'offers',
          'uncertain_regions',
          'page_summary'
        ],
        additionalProperties: false,
        properties: {
          schema_version: { type: 'number', const: 1 },
          page_number: { type: 'number' },
          page_classification: {
            type: 'string',
            enum: [
              'offer_page',
              'cover',
              'advertisement',
              'terms',
              'blank',
              'mixed',
              'unknown'
            ]
          },
          offers: {
            type: 'array',
            items: {
              type: 'object',
              required: [
                'temporary_offer_id',
                'region_hint',
                'product',
                'price_candidates',
                'selected_prices',
                'content',
                'price_basis',
                'promotion',
                'evidence',
                'confidence',
                'warnings'
              ],
              additionalProperties: false,
              properties: {
                temporary_offer_id: { type: 'string' },
                region_hint: {
                  type: 'string',
                  enum: [
                    'top_left',
                    'top',
                    'top_right',
                    'middle_left',
                    'middle',
                    'middle_right',
                    'bottom_left',
                    'bottom',
                    'bottom_right',
                    'unknown'
                  ]
                },
                product: {
                  type: 'object',
                  required: [
                    'title_ar',
                    'title_en',
                    'brand_text',
                    'description_ar',
                    'description_en',
                    'item_domain',
                    'variant_names'
                  ],
                  additionalProperties: false,
                  properties: {
                    title_ar: { type: ['string', 'null'] },
                    title_en: { type: ['string', 'null'] },
                    brand_text: { type: ['string', 'null'] },
                    description_ar: { type: ['string', 'null'] },
                    description_en: { type: ['string', 'null'] },
                    item_domain: {
                      type: 'string',
                      enum: [
                        'grocery',
                        'household',
                        'personal_care',
                        'electronics',
                        'appliance',
                        'other_non_grocery',
                        'unknown'
                      ]
                    },
                    variant_names: {
                      type: 'array',
                      items: { type: 'string' }
                    }
                  }
                },
                price_candidates: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: [
                      'raw_text',
                      'normalized_value',
                      'currency',
                      'role',
                      'is_crossed_out',
                      'confidence',
                      'evidence_text'
                    ],
                    additionalProperties: false,
                    properties: {
                      raw_text: { type: 'string' },
                      normalized_value: { type: ['number', 'null'] },
                      currency: { type: ['string', 'null'], enum: ['SAR', null] },
                      role: {
                        type: 'string',
                        enum: [
                          'current_offer_price',
                          'original_old_price',
                          'multi_buy_total_price',
                          'loyalty_price',
                          'ambiguous_price',
                          'not_a_price'
                        ]
                      },
                      is_crossed_out: { type: ['boolean', 'null'] },
                      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                      evidence_text: { type: 'string' }
                    }
                  }
                },
                selected_prices: {
                  type: 'object',
                  required: [
                    'offer_price',
                    'original_price',
                    'currency',
                    'offer_price_raw_text',
                    'original_price_raw_text',
                    'confidence'
                  ],
                  additionalProperties: false,
                  properties: {
                    offer_price: { type: ['number', 'null'] },
                    original_price: { type: ['number', 'null'] },
                    currency: { type: ['string', 'null'], enum: ['SAR', null] },
                    offer_price_raw_text: { type: ['string', 'null'] },
                    original_price_raw_text: { type: ['string', 'null'] },
                    confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
                  }
                },
                content: {
                  type: 'object',
                  required: [
                    'size_text',
                    'each_size_value',
                    'each_size_unit',
                    'pack_quantity',
                    'bundle_quantity',
                    'total_content_value',
                    'total_content_unit'
                  ],
                  additionalProperties: false,
                  properties: {
                    size_text: { type: ['string', 'null'] },
                    each_size_value: { type: ['number', 'null'] },
                    each_size_unit: {
                      type: ['string', 'null'],
                      enum: [
                        'liter',
                        'milliliter',
                        'kilogram',
                        'gram',
                        'piece',
                        'dozen',
                        'inch',
                        'other',
                        null
                      ]
                    },
                    pack_quantity: { type: ['number', 'null'] },
                    bundle_quantity: { type: ['number', 'null'] },
                    total_content_value: { type: ['number', 'null'] },
                    total_content_unit: {
                      type: ['string', 'null'],
                      enum: [
                        'liter',
                        'milliliter',
                        'kilogram',
                        'gram',
                        'piece',
                        'dozen',
                        'other',
                        null
                      ]
                    }
                  }
                },
                price_basis: {
                  type: 'object',
                  required: ['basis', 'raw_text'],
                  additionalProperties: false,
                  properties: {
                    basis: {
                      type: 'string',
                      enum: [
                        'each',
                        'per_pack',
                        'per_box',
                        'per_bag',
                        'per_kg',
                        'per_2kg',
                        'per_dozen',
                        'bundle',
                        'multi_buy',
                        'unknown'
                      ]
                    },
                    raw_text: { type: ['string', 'null'] }
                  }
                },
                promotion: {
                  type: 'object',
                  required: ['mechanic', 'raw_text', 'condition_text'],
                  additionalProperties: false,
                  properties: {
                    mechanic: {
                      type: 'string',
                      enum: [
                        'standard_price',
                        'bogo',
                        'bundle',
                        'multi_buy',
                        'loyalty_required',
                        'selected_branches',
                        'unknown'
                      ]
                    },
                    raw_text: { type: ['string', 'null'] },
                    condition_text: { type: ['string', 'null'] }
                  }
                },
                evidence: {
                  type: 'object',
                  required: [
                    'title_texts',
                    'description_texts',
                    'current_price_texts',
                    'original_price_texts',
                    'size_content_texts',
                    'promotion_texts',
                    'final_evidence_summary'
                  ],
                  additionalProperties: false,
                  properties: {
                    title_texts: { type: 'array', items: { type: 'string' } },
                    description_texts: { type: 'array', items: { type: 'string' } },
                    current_price_texts: { type: 'array', items: { type: 'string' } },
                    original_price_texts: { type: 'array', items: { type: 'string' } },
                    size_content_texts: { type: 'array', items: { type: 'string' } },
                    promotion_texts: { type: 'array', items: { type: 'string' } },
                    final_evidence_summary: { type: 'string' }
                  }
                },
                confidence: {
                  type: 'object',
                  required: [
                    'overall',
                    'product_identity',
                    'current_price',
                    'original_price',
                    'size_content',
                    'promotion'
                  ],
                  additionalProperties: false,
                  properties: {
                    overall: { type: 'string', enum: ['high', 'medium', 'low'] },
                    product_identity: { type: 'string', enum: ['high', 'medium', 'low'] },
                    current_price: { type: 'string', enum: ['high', 'medium', 'low'] },
                    original_price: { type: 'string', enum: ['high', 'medium', 'low'] },
                    size_content: { type: 'string', enum: ['high', 'medium', 'low'] },
                    promotion: { type: 'string', enum: ['high', 'medium', 'low'] }
                  }
                },
                warnings: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['code', 'message', 'blocking'],
                    additionalProperties: false,
                    properties: {
                      code: { type: 'string' },
                      message: { type: 'string' },
                      blocking: { type: 'boolean' }
                    }
                  }
                }
              }
            }
          },
          uncertain_regions: {
            type: 'array',
            items: {
              type: 'object',
              required: ['region_hint', 'reason', 'description'],
              additionalProperties: false,
              properties: {
                region_hint: {
                  type: 'string',
                  enum: [
                    'top_left',
                    'top',
                    'top_right',
                    'middle_left',
                    'middle',
                    'middle_right',
                    'bottom_left',
                    'bottom',
                    'bottom_right',
                    'unknown'
                  ]
                },
                reason: {
                  type: 'string',
                  enum: [
                    'possible_unread_offer',
                    'ambiguous_price',
                    'ambiguous_product_group',
                    'possible_shared_price',
                    'low_visual_confidence',
                    'other'
                  ]
                },
                description: { type: 'string' }
              }
            }
          },
          page_summary: {
            type: 'object',
            required: [
              'independent_offer_count',
              'independent_current_price_anchor_count',
              'offers_with_original_price_count',
              'offers_with_size_or_content_count',
              'bundle_or_multi_buy_count',
              'low_confidence_offer_count',
              'final_completeness_check_performed'
            ],
            additionalProperties: false,
            properties: {
              independent_offer_count: { type: 'number' },
              independent_current_price_anchor_count: { type: 'number' },
              offers_with_original_price_count: { type: 'number' },
              offers_with_size_or_content_count: { type: 'number' },
              bundle_or_multi_buy_count: { type: 'number' },
              low_confidence_offer_count: { type: 'number' },
              final_completeness_check_performed: { type: 'boolean' }
            }
          }
        }
      }
    }
  };
}
