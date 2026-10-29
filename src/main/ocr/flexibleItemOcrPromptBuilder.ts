export function buildFlexibleItemOcrPrompt(itemNumber?: string): string {
  return `You are reading one cropped item image from a supermarket promotion flyer.
${itemNumber ? `This is item number: ${itemNumber}\n` : ''}
Return only a minimal JSON object.

Only include keys for information visibly present in this item image.

Do not include markdown.
Do not include prose.
Do not include comments.
Do not include explanation text.
Do not include null fields.
Do not include empty fields.
Do not include metadata.

Do not include:
- supermarket name
- PDF filename
- page number
- box number
- image path
- leaflet date
- city
- region
- crop coordinates
- confidence
- warnings
- errors
- model name
- API metadata

Use clear, concise JSON keys.
Snake_case keys are preferred, but do not force a fixed schema.

Return any useful product or offer fields visible in the image, such as:
- Arabic product name
- English product name
- description
- offer price
- original price
- currency
- size
- unit
- pack quantity
- bundle quantity
- special offer
- price condition
- flavor
- variant
- country of origin
- storage condition
- any other visibly useful item/offer attribute

Do not invent values.

Return valid JSON object only.`
}
