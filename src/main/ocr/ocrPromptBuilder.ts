export function buildWifranLeafletExtractionPrompt(input: { originalPageNumbers: number[] }): string {
  const pageNumbersStr = input.originalPageNumbers.join(', ')
  
  return `
You are extracting grocery product offers from a Saudi supermarket promotional leaflet (Othaim / العثيم).

RULES:
- Return only valid JSON matching the schema. No markdown, no explanation, no prose.
- Extract each product-offer block as one item row.
- A product-offer block consists of: a product photo, the product name (Arabic and/or English), the offer price (bold number), optionally the old/original price (crossed out), pack size, discount badge, and brand name.
- EVERY real product MUST have an offer_price. Read the large bold number on or near the colored price tag below each product image. If you cannot read it, set offer_price to null but still include the item.
- Products come in DIFFERENT SIZES on the page. Some items occupy a full column width or half the page; others are small grid cells. Extract ALL of them regardless of size.
- The image_id MUST be the product photo (e.g. a food package, cleaning bottle, etc.), NOT the supermarket logo, NOT a discount badge, NOT a decorative graphic, NOT a category banner.
- Associate nearby price, old price, discount badge, product image, product name, pack size, and notes into one item row.
- Do not create separate rows for: prices alone, old prices alone, discount badges alone, SKU/item codes alone, branch notes alone, Or/أو labels alone.
- If a price is above a product image and the name is below the image, treat them as one product offer block.
- If a discount badge such as 1+1 or 1+2 is attached to a product, store it in discount_text.
- If a discount badge appears alone without a product, ignore it.
- If an Or/أو badge connects alternative products in the same offer area, capture it in notes_ar or discount_text; do not create an Or/أو row.
- Ignore campaign banners, cover graphics, page headers, page footers, supermarket logos, sponsor logos, date badges, decorative graphics, and generic promotion slogans unless they are part of a specific product offer item.
- Do not create rows from text like عروض تزين عيدك or هنا التوفير or خيارات أكثر unless attached to a specific product offer.
- Use null for unknown optional values.
- Use 1-indexed original PDF page numbers.
- The original PDF page numbers in this request are: ${pageNumbersStr}.
- Include the markdown image ID (e.g. img-0.jpeg) of the main product image as image_id.
- You MUST provide the bounding_box for each item. The bounding_box MUST encompass the ENTIRE product offer (the product packaging AND the price tag).
- Format bounding_box as a 4-element array [ymin, xmin, ymax, xmax] using coordinates normalized to a 1000x1000 scale.
- DO NOT output the bounding box of just a small discount badge or a logo. If unsure, provide the bounding box of the main product photo.
`
}

export function buildWifranDocumentAnnotationFormat(): unknown {
  return {
    "type": "json_schema",
    "json_schema": {
      "name": "wifran_offers",
      "schema": {
        "type": "object",
        "properties": {
          "items": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "row_id": { "type": "string" },
                "page_number": { "type": "integer" },
                "product_name_ar": { "type": ["string", "null"] },
                "product_name_en": { "type": ["string", "null"] },
                "brand_name_ar": { "type": ["string", "null"] },
                "brand_name_en": { "type": ["string", "null"] },
                "category_name_ar": { "type": ["string", "null"] },
                "category_name_en": { "type": ["string", "null"] },
                "description_ar": { "type": ["string", "null"] },
                "description_en": { "type": ["string", "null"] },
                "offer_price": { "type": ["number", "string", "null"] },
                "original_price": { "type": ["number", "string", "null"] },
                "discount_text": { "type": ["string", "null"] },
                "pack_size_value": { "type": ["number", "string", "null"] },
                "pack_size_unit": { "type": ["string", "null"] },
                "pack_quantity": { "type": ["number", "string", "null"] },
                "notes_ar": { "type": ["string", "null"] },
                "image_id": { "type": ["string", "null"] },
                "bounding_box": {
                  "type": ["array", "null"],
                  "items": { "type": "number" },
                  "minItems": 4,
                  "maxItems": 4,
                  "description": "Standard Mistral format [ymin, xmin, ymax, xmax] scaled to 1000"
                }
              },
              "required": ["page_number"]
            }
          }
        },
        "required": ["items"],
        "additionalProperties": false
      }
    }
  }
}

export function buildWifranCropExtractionPrompt(): string {
  return `
You are extracting grocery product offers from a cropped image of a Saudi supermarket promotional leaflet (Othaim / العثيم).

RULES:
- Return only valid JSON matching the schema. No explanation, no prose.
- Extract the product-offer shown in the image.
- If there are multiple products clearly visible in this crop, extract them as separate items in the array. Usually there is only 1 product.
- A product-offer consists of: a product photo, the product name (Arabic and/or English), the offer price (bold number), optionally the old/original price (crossed out), pack size, discount badge, and brand name.
- EVERY real product MUST have an offer_price. Read the large bold number on or near the colored price tag.
- Ignore generic logos, banners, or decorative graphics if they don't contain a specific product offer.
- Use null for unknown optional values.
`
}

export function buildWifranCropAnnotationFormat(): unknown {
  return {
    "type": "json_schema",
    "json_schema": {
      "name": "wifran_crop_offers",
      "schema": {
        "type": "object",
        "properties": {
          "items": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "product_name_ar": { "type": ["string", "null"] },
                "product_name_en": { "type": ["string", "null"] },
                "brand_name_ar": { "type": ["string", "null"] },
                "brand_name_en": { "type": ["string", "null"] },
                "category_name_ar": { "type": ["string", "null"] },
                "category_name_en": { "type": ["string", "null"] },
                "description_ar": { "type": ["string", "null"] },
                "description_en": { "type": ["string", "null"] },
                "offer_price": { "type": ["number", "string", "null"] },
                "original_price": { "type": ["number", "string", "null"] },
                "discount_text": { "type": ["string", "null"] },
                "pack_size_value": { "type": ["number", "string", "null"] },
                "pack_size_unit": { "type": ["string", "null"] },
                "pack_quantity": { "type": ["number", "string", "null"] },
                "notes_ar": { "type": ["string", "null"] }
              },
              "required": []
            }
          }
        },
        "required": ["items"],
        "additionalProperties": false
      }
    }
  }
}

export function buildWifranFullPageExtractionPrompt(): string {
  return `
You are extracting ALL grocery product offers from a FULL PAGE image of a Saudi supermarket promotional leaflet (Othaim / العثيم).

CRITICAL: You MUST find and extract EVERY single product offer on this page. Do NOT miss any items.

WHAT IS A PRODUCT OFFER:
- A product offer block typically has: a product image/photo, a product name (Arabic and/or English), and a price (usually a bold number on a colored tag).
- Some products share a visual area or are in a dense grid layout — you must still extract each one separately.
- Products can be of DIFFERENT SIZES on the page: large hero items, medium items, small grid items.
- Count EVERY product with a visible price tag, no matter how small.

HOW TO FIND ALL PRODUCTS:
1. Scan the page systematically from top-left to bottom-right.
2. Look for colored price tags (green, red, yellow backgrounds with bold numbers) — each price tag usually means one product.
3. Look for product photos — each distinct product photo paired with a price is one item.
4. In grid layouts, products are arranged in rows and columns. Count each cell.
5. If you see an "Or / أو" connecting two products at the same price, that's ONE offer block.

RULES:
- STRICT ANTI-HALLUCINATION: Only extract products that ACTUALLY exist in the image. DO NOT invent or guess products.
- Return only valid JSON matching the schema. No markdown, no explanation, no prose.
- Extract each product-offer block as one item.
- EVERY product MUST have an offer_price. Read the large bold number on the price tag.
- Extract the product name, description (if available), offer price, original price, size (including unit), and any special offer conditions (like 2+1, bundle deal, etc.).
- DO NOT include any other data.
- Ignore: campaign banners, page headers, page footers, supermarket logos.
- Use null for unknown optional values.
`
}

export function buildWifranFullPageAnnotationFormat(): unknown {
  return {
    "type": "json_schema",
    "json_schema": {
      "name": "wifran_fullpage_offers",
      "schema": {
        "type": "object",
        "properties": {
          "total_products_visible": {
            "type": "integer",
            "description": "Total number of distinct product offers you can see on this page"
          },
          "items": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "product_name_ar": { "type": ["string", "null"] },
                "product_name_en": { "type": ["string", "null"] },
                "description_ar": { "type": ["string", "null"] },
                "description_en": { "type": ["string", "null"] },
                "offer_price": { "type": ["number", "string", "null"] },
                "original_price": { "type": ["number", "string", "null"] },
                "pack_size_value": { "type": ["number", "string", "null"] },
                "pack_size_unit": { "type": ["string", "null"] },
                "discount_text": { "type": ["string", "null"], "description": "Special offer conditions (2+1, bundle deal, etc.)" },
                "notes_ar": { "type": ["string", "null"] }
              },
              "required": ["product_name_ar", "offer_price"]
            }
          }
        },
        "required": ["total_products_visible", "items"],
        "additionalProperties": false
      }
    }
  }
}

