import { buildItemOcrJsonSchema } from '../../shared/schemas/itemOcrSchema'

/**
 * Builds the system prompt for single-item OCR extraction from a cropped supermarket offer image.
 */
export function buildItemImageOcrPrompt(itemNumber: string): string {
  return `You are reading one cropped item image from a Saudi supermarket promotion leaflet.

The app has already assigned this crop the item number:

${itemNumber}

Return strict valid JSON only.
Do not return markdown.
Do not return prose.
Do not return comments.
Do not include keys outside the expected schema.

Your task is not only to pick final fields.
Your task is to extract visual evidence.

The image may contain:
- current offer price
- old/original/crossed-out price
- product name in Arabic and/or English
- product description
- product size/content such as 1.5L, 730ml, 10kg, 8 × 135g, 30PCS
- pack quantity
- bundle/promotion labels such as 1+1, 1+2, 2+1, 6+1, 2 for 10
- price basis such as each, per pack, per box, per bag, per kg, per 2kg, per dozen
- non-grocery attributes such as screen size, resolution, features, streaming services

Important safety rules:
- 1.5L is a size/content value, not an offer price.
- 730ml is a size/content value, not an offer price.
- 10kg is a size/content value, not an offer price.
- 8 × 135g is pack/content information, not an offer price.
- 30PCS is quantity/content information, not an offer price.
- 50 inch, 55 inch, 65 inch, 4K, HD, LED are product attributes, not offer prices.
- A crossed-out, smaller, or old price must not be selected as the current offer price.
- If both a prominent current price and an old price are visible, classify both separately.
- If a number is attached to L/ml/kg/g/pcs/inch, classify it as size/content/screen_size unless there is clear visual evidence it is a price.
- If a price is visually ambiguous, do not guess. Return a blocking warning.

Extract every visible price-like number as a price candidate.
Extract every visible size/content-like number as a size candidate.
Then select the most likely current offer price and original price, if visible.

For each price candidate, include:
- raw visible text
- normalized numeric value
- visual role
- selected classification
- confidence
- visual evidence

For each size/content candidate, include:
- raw visible text
- normalized value if possible
- unit
- classification
- confidence
- visual evidence

Visual evidence must include any visible clues such as:
- color of the number/text if obvious
- price block color if obvious
- whether the number is large/prominent
- whether the number is crossed out
- whether it is attached to L/ml/kg/g/pcs/inch
- whether it is near product title/package text
- approximate position such as top-left, bottom-right, center
- whether it appears inside a price block or product description area

Classify item_domain as one of:
- grocery
- household
- personal_care
- electronics
- appliance
- other_non_grocery
- unknown

Return confidence values as:
- high
- medium
- low

Allowed publish decisions:
- publish
- publish_but_exclude_from_comparison
- skip_or_quarantine

Use publish only if the current offer price and product title are clear.
Use publish_but_exclude_from_comparison if the item is safe to display but pack size, comparison unit, category, or content is uncertain.
Use skip_or_quarantine if the current offer price is missing, ambiguous, likely a size, likely the old price, or the product title is missing.

Return JSON using the expected schema.`
}

/**
 * Returns the JSON schema object to pass to Mistral response_format.
 */
export function buildItemImageOcrSchema(): unknown {
  return buildItemOcrJsonSchema()
}
