export function buildMinimalOcrPrompt(): string {
  return `
You are extracting supermarket leaflet product offers.

Return only valid JSON matching the exact schema.

Do not include markdown.
Do not include prose.
Do not include explanations.
Do not include comments.
Do not include any keys not present in the schema.

Extract every visible product offer item on this page.

For each item, extract only:
- item_number
- Arabic name
- English name
- Arabic description, if available
- English description, if available
- current offer price
- original/old price, if visible
- size including value, unit, and raw text
- pack_quantity
- bundle_quantity
- special offer condition such as 2+1, 1+1, 1+2, 6+1, bundle deal, per kg, per pack, per box, per bag, loyalty-only, selected branches only, or other visible condition.

Do not extract:
- bounding boxes
- coordinates
- brand fields
- category fields
- confidence
- warnings
- source metadata
- image metadata
- SKU-only rows
- logo/header/footer text
- campaign banners
- page titles
- date badges
- standalone old prices
- standalone discount badges
- standalone unit labels
- standalone branch notes

A valid item is a product offer block with a product name or clear product visual and a visible offer price.

Associate the current price with the nearest product block.

Many Saudi leaflet prices are stylized:
- 24 99 means 24.99
- 13 99 means 13.99
- ٢٤ ٩٩ means 24.99
- large number plus small cents is a decimal price.

Use null for unknown optional values.

Do not invent missing values.

Do not invent prices.

Do not invent quantities.

The page number must appear once at the top level only.
Do not include page_number inside item objects.
item_count must equal the number of items.
item_number must be sequential: "001", "002", "003".

EXAMPLES OF QUANTITY HANDLING:

Example 1: pack quantity from size text
Visible text: 8x135g
Expected fields:
{
  "size": {
    "value": 135,
    "unit": "g",
    "text": "8x135g"
  },
  "pack_quantity": 8,
  "bundle_quantity": null,
  "special_offer": "Per Pack"
}

Example 2: bundle quantity from 1+1
Visible text: 1+1
Expected fields:
{
  "pack_quantity": 2,
  "bundle_quantity": 2,
  "special_offer": "1+1"
}

Example 3: bundle quantity from 1+2
Visible text: 1+2
Expected fields:
{
  "pack_quantity": 3,
  "bundle_quantity": 3,
  "special_offer": "1+2"
}

Example 4: pieces count
Visible text: 30PCS
Expected fields:
{
  "size": {
    "value": 30,
    "unit": "pcs",
    "text": "30PCS"
  },
  "pack_quantity": 30,
  "bundle_quantity": null,
  "special_offer": "Per Plate"
}

Example 5: per kg offer
Visible text: Per Kg
Expected fields:
{
  "size": {
    "value": null,
    "unit": "kg",
    "text": "Per Kg"
  },
  "pack_quantity": null,
  "bundle_quantity": null,
  "special_offer": "Per Kg"
}
`
}

export function buildMinimalOcrSchema(): unknown {
  return {
    "type": "json_schema",
    "json_schema": {
      "name": "minimal_wifran_offers",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "page_number": { "type": "integer" },
          "item_count": { "type": "integer" },
          "items": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "item_number": { "type": "string" },
                "name_ar": { "type": ["string", "null"] },
                "name_en": { "type": ["string", "null"] },
                "description_ar": { "type": ["string", "null"] },
                "description_en": { "type": ["string", "null"] },
                "offer_price": { "type": ["number", "null"] },
                "original_price": { "type": ["number", "null"] },
                "size": {
                  "type": "object",
                  "properties": {
                    "value": { "type": ["number", "null"] },
                    "unit": { "type": ["string", "null"] },
                    "text": { "type": ["string", "null"] }
                  },
                  "required": ["value", "unit", "text"],
                  "additionalProperties": false
                },
                "pack_quantity": { "type": ["number", "null"] },
                "bundle_quantity": { "type": ["number", "null"] },
                "special_offer": { "type": ["string", "null"] }
              },
              "required": [
                "item_number", "name_ar", "name_en", "description_ar", "description_en",
                "offer_price", "original_price", "size", "pack_quantity", "bundle_quantity", "special_offer"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": ["page_number", "item_count", "items"],
        "additionalProperties": false
      }
    }
  }
}
