# Sample Extraction JSON

## 1. Purpose of This Document

This document provides sample OCR extraction JSON for Wifran Offers Extractor.

Antigravity must use this document when implementing:

* OCR prompt examples.
* JSON validation.
* Zod schemas.
* Test fixtures.
* Import row creation.
* Normalization logic.
* Database mapping.
* Image cropping tests.
* Handling skipped non-product promotional areas.

These examples show the expected shape and quality of extracted supermarket offer data before it is normalized and synced into the Wifran database.

## 2. Important Notes

The examples in this file are sample extraction outputs.

They are not final database rows.

The app must still:

* Validate every field.
* Normalize prices.
* Normalize units.
* Validate page numbers.
* Validate bounding boxes.
* Detect non-product promotional/banner rows.
* Match or create brands.
* Match categories.
* Match or create products.
* Detect duplicate offers.
* Crop and upload item images.
* Create `import_rows`.
* Create final `offers` only for valid product offer rows.

OCR output must never be inserted directly into the `offers` table without validation and normalization.

## 3. Required Top-Level Shape

Every OCR result must normalize to this shape:

```json
{
  "items": []
}
```

If no product offer items are found, return:

```json
{
  "items": []
}
```

This is especially important for cover pages, campaign banners, and pages that contain no real product offers.

## 4. Full Example: Valid Product Offer Items

This example contains valid product-level offer items.

```json
{
  "items": [
    {
      "row_id": "page-1-item-1",
      "page_number": 1,
      "product_name_ar": "حليب هايل بودرة",
      "product_name_en": "Haley Milk Powder",
      "brand_name_ar": "هايل",
      "brand_name_en": "Haley",
      "category_name_ar": "المواد الغذائية الأساسية",
      "category_name_en": "Staples",
      "description_ar": null,
      "description_en": null,
      "offer_price": 62.95,
      "original_price": 125.9,
      "discount_text": "1+1",
      "pack_size_value": 1800,
      "pack_size_unit": "g",
      "pack_quantity": 2,
      "unit_price": null,
      "unit_price_unit": "g",
      "quantity_limit": null,
      "is_loyalty_required": false,
      "loyalty_notes_ar": null,
      "loyalty_notes_en": null,
      "notes_ar": "2 حبة",
      "notes_en": "2 PCS",
      "bounding_box": {
        "x": 120,
        "y": 450,
        "width": 300,
        "height": 300
      },
      "confidence": 0.92,
      "warnings": []
    },
    {
      "row_id": "page-1-item-2",
      "page_number": 1,
      "product_name_ar": "معجون طماطم ندى",
      "product_name_en": "Nada Tomato Paste",
      "brand_name_ar": "ندى",
      "brand_name_en": "Nada",
      "category_name_ar": "الأغذية المعلبة",
      "category_name_en": "Canned Food",
      "description_ar": null,
      "description_en": null,
      "offer_price": 11.5,
      "original_price": 23,
      "discount_text": "2+2",
      "pack_size_value": 135,
      "pack_size_unit": "g",
      "pack_quantity": 4,
      "unit_price": null,
      "unit_price_unit": "g",
      "quantity_limit": null,
      "is_loyalty_required": false,
      "loyalty_notes_ar": null,
      "loyalty_notes_en": null,
      "notes_ar": "4 ربطات",
      "notes_en": "4 Packs",
      "bounding_box": {
        "x": 430,
        "y": 450,
        "width": 300,
        "height": 300
      },
      "confidence": 0.9,
      "warnings": []
    },
    {
      "row_id": "page-1-item-3",
      "page_number": 1,
      "product_name_ar": "هايل مكرونة",
      "product_name_en": "Haley Macaroni",
      "brand_name_ar": "هايل",
      "brand_name_en": "Haley",
      "category_name_ar": "المواد الغذائية الأساسية",
      "category_name_en": "Staples",
      "description_ar": null,
      "description_en": null,
      "offer_price": 9.75,
      "original_price": 19.5,
      "discount_text": "3+3",
      "pack_size_value": 400,
      "pack_size_unit": "g",
      "pack_quantity": 6,
      "unit_price": null,
      "unit_price_unit": "g",
      "quantity_limit": null,
      "is_loyalty_required": false,
      "loyalty_notes_ar": null,
      "loyalty_notes_en": null,
      "notes_ar": "6 حبات",
      "notes_en": "6 PCS",
      "bounding_box": {
        "x": 760,
        "y": 450,
        "width": 300,
        "height": 300
      },
      "confidence": 0.91,
      "warnings": []
    }
  ]
}
```

## 5. Example: Frozen Carton Offer

This example shows a carton/box style product offer.

```json
{
  "items": [
    {
      "row_id": "page-2-item-1",
      "page_number": 2,
      "product_name_ar": "ساديا دجاج",
      "product_name_en": "Sadia Chicken",
      "brand_name_ar": "ساديا",
      "brand_name_en": "Sadia",
      "category_name_ar": "المجمدات",
      "category_name_en": "Frozen",
      "description_ar": null,
      "description_en": null,
      "offer_price": 154.99,
      "original_price": 185,
      "discount_text": null,
      "pack_size_value": 1000,
      "pack_size_unit": "g",
      "pack_quantity": 10,
      "unit_price": null,
      "unit_price_unit": "g",
      "quantity_limit": null,
      "is_loyalty_required": false,
      "loyalty_notes_ar": null,
      "loyalty_notes_en": null,
      "notes_ar": "للكرتون",
      "notes_en": "Per Box",
      "bounding_box": {
        "x": 80,
        "y": 900,
        "width": 350,
        "height": 320
      },
      "confidence": 0.88,
      "warnings": []
    }
  ]
}
```

Important interpretation:

* `pack_size_value = 1000`
* `pack_size_unit = g`
* `pack_quantity = 10`
* `notes_ar = للكرتون`
* `notes_en = Per Box`

The app should preserve carton wording in notes.

## 6. Example: Single Bag Offer

```json
{
  "items": [
    {
      "row_id": "page-2-item-2",
      "page_number": 2,
      "product_name_ar": "العثيم سكر",
      "product_name_en": "Othaim Sugar",
      "brand_name_ar": "العثيم",
      "brand_name_en": "Othaim",
      "category_name_ar": "المواد الغذائية الأساسية",
      "category_name_en": "Staples",
      "description_ar": null,
      "description_en": null,
      "offer_price": 31.95,
      "original_price": 39.95,
      "discount_text": null,
      "pack_size_value": 10,
      "pack_size_unit": "kg",
      "pack_quantity": 1,
      "unit_price": null,
      "unit_price_unit": "kg",
      "quantity_limit": null,
      "is_loyalty_required": false,
      "loyalty_notes_ar": null,
      "loyalty_notes_en": null,
      "notes_ar": "للكيس",
      "notes_en": "Per Bag",
      "bounding_box": {
        "x": 460,
        "y": 900,
        "width": 330,
        "height": 310
      },
      "confidence": 0.9,
      "warnings": []
    }
  ]
}
```

## 7. Example: Dairy Product With Description

```json
{
  "items": [
    {
      "row_id": "page-3-item-1",
      "page_number": 3,
      "product_name_ar": "جبن كيري بالقشطة",
      "product_name_en": "Kiri Cream Cheese",
      "brand_name_ar": "كيري",
      "brand_name_en": "Kiri",
      "category_name_ar": "الألبان",
      "category_name_en": "Dairy",
      "description_ar": "24 قطعة",
      "description_en": "24 Portions",
      "offer_price": 22.95,
      "original_price": 32.5,
      "discount_text": null,
      "pack_size_value": 432,
      "pack_size_unit": "g",
      "pack_quantity": 1,
      "unit_price": null,
      "unit_price_unit": "g",
      "quantity_limit": null,
      "is_loyalty_required": false,
      "loyalty_notes_ar": null,
      "loyalty_notes_en": null,
      "notes_ar": "للحبة",
      "notes_en": "Each",
      "bounding_box": {
        "x": 100,
        "y": 320,
        "width": 310,
        "height": 300
      },
      "confidence": 0.89,
      "warnings": []
    }
  ]
}
```

## 8. Example: Household Multipack

```json
{
  "items": [
    {
      "row_id": "page-3-item-2",
      "page_number": 3,
      "product_name_ar": "النورس مناديل",
      "product_name_en": "Nawras Tissues",
      "brand_name_ar": "النورس",
      "brand_name_en": "Nawras",
      "category_name_ar": "العناية المنزلية",
      "category_name_en": "Household",
      "description_ar": null,
      "description_en": null,
      "offer_price": 19.99,
      "original_price": 26.5,
      "discount_text": null,
      "pack_size_value": 150,
      "pack_size_unit": "piece",
      "pack_quantity": 10,
      "unit_price": null,
      "unit_price_unit": "piece",
      "quantity_limit": null,
      "is_loyalty_required": false,
      "loyalty_notes_ar": null,
      "loyalty_notes_en": null,
      "notes_ar": "للربطة",
      "notes_en": "Per Pack",
      "bounding_box": {
        "x": 440,
        "y": 320,
        "width": 310,
        "height": 300
      },
      "confidence": 0.87,
      "warnings": []
    }
  ]
}
```

## 9. Example: Household Liquid Bundle

```json
{
  "items": [
    {
      "row_id": "page-3-item-3",
      "page_number": 3,
      "product_name_ar": "سائل غسيل الصحون فيري",
      "product_name_en": "Fairy Dishwash Liquid",
      "brand_name_ar": "فيري",
      "brand_name_en": "Fairy",
      "category_name_ar": "العناية المنزلية",
      "category_name_en": "Household",
      "description_ar": "بالليمون",
      "description_en": "Lemon",
      "offer_price": 28.5,
      "original_price": 39.95,
      "discount_text": null,
      "pack_size_value": 1,
      "pack_size_unit": "l",
      "pack_quantity": 2,
      "unit_price": null,
      "unit_price_unit": "l",
      "quantity_limit": null,
      "is_loyalty_required": false,
      "loyalty_notes_ar": null,
      "loyalty_notes_en": null,
      "notes_ar": "للربطة",
      "notes_en": "Per Pack",
      "bounding_box": {
        "x": 780,
        "y": 320,
        "width": 310,
        "height": 300
      },
      "confidence": 0.86,
      "warnings": []
    }
  ]
}
```

Note:

* Unit should be normalized from `liter` / `لتر` to `l`.
* If the DB expects `liter`, map it during DB sync.

## 10. Example: Household Powder

```json
{
  "items": [
    {
      "row_id": "page-3-item-4",
      "page_number": 3,
      "product_name_ar": "مسحوق غسيل تايد",
      "product_name_en": "Tide Washing Powder",
      "brand_name_ar": "تايد",
      "brand_name_en": "Tide",
      "category_name_ar": "العناية المنزلية",
      "category_name_en": "Household",
      "description_ar": "مركز",
      "description_en": "Concentrated",
      "offer_price": 51.95,
      "original_price": 89.95,
      "discount_text": null,
      "pack_size_value": 5,
      "pack_size_unit": "kg",
      "pack_quantity": 1,
      "unit_price": null,
      "unit_price_unit": "kg",
      "quantity_limit": null,
      "is_loyalty_required": false,
      "loyalty_notes_ar": null,
      "loyalty_notes_en": null,
      "notes_ar": "للكيس",
      "notes_en": "Per Bag",
      "bounding_box": {
        "x": 110,
        "y": 660,
        "width": 320,
        "height": 310
      },
      "confidence": 0.9,
      "warnings": []
    }
  ]
}
```

## 11. Example: Page With Only Campaign Banner

This is an important negative example.

If a page or page region contains only campaign graphics such as:

```text
1+1 عروض تزين عيدك
هنا التوفير
May 27 - June 02
Supermarket logo
Sponsored by Lurpak
Decorative balloons
```

and no specific product offer items, OCR must return:

```json
{
  "items": []
}
```

The app must not create product, brand, category, cropped item image, or offer rows from this content.

## 12. Example: Bad OCR Output That Must Be Skipped

Sometimes OCR may incorrectly return a banner as an item.

Example bad row:

```json
{
  "items": [
    {
      "row_id": "page-1-item-1",
      "page_number": 1,
      "product_name_ar": "عروض تزين عيدك",
      "product_name_en": "Eid Offers",
      "brand_name_ar": "العثيم",
      "brand_name_en": "Othaim",
      "category_name_ar": null,
      "category_name_en": null,
      "description_ar": "1+1",
      "description_en": "1+1",
      "offer_price": 1,
      "original_price": null,
      "discount_text": "1+1",
      "pack_size_value": null,
      "pack_size_unit": null,
      "pack_quantity": 1,
      "unit_price": null,
      "unit_price_unit": null,
      "quantity_limit": null,
      "is_loyalty_required": false,
      "loyalty_notes_ar": null,
      "loyalty_notes_en": null,
      "notes_ar": "هنا التوفير",
      "notes_en": "Savings here",
      "bounding_box": {
        "x": 0,
        "y": 0,
        "width": 1200,
        "height": 300
      },
      "confidence": 0.55,
      "warnings": ["POSSIBLE_NON_PRODUCT_PROMOTIONAL_AREA"]
    }
  ]
}
```

Expected app handling:

```json
{
  "status": "skipped",
  "skip_reason": "NON_PRODUCT_PROMOTIONAL_AREA",
  "created_offer_id": null
}
```

The app should:

* Save as `import_rows` only if useful for traceability.
* Add validation error/info code `NON_PRODUCT_PROMOTIONAL_AREA`.
* Not create a product.
* Not create a brand.
* Not create an offer.
* Not crop or upload an item image.

## 13. Example: Missing Price

```json
{
  "items": [
    {
      "row_id": "page-4-item-1",
      "page_number": 4,
      "product_name_ar": "زيت دوار الشمس",
      "product_name_en": "Sunflower Oil",
      "brand_name_ar": null,
      "brand_name_en": null,
      "category_name_ar": "المواد الغذائية الأساسية",
      "category_name_en": "Staples",
      "description_ar": null,
      "description_en": null,
      "offer_price": null,
      "original_price": null,
      "discount_text": null,
      "pack_size_value": 1.8,
      "pack_size_unit": "l",
      "pack_quantity": 1,
      "unit_price": null,
      "unit_price_unit": "l",
      "quantity_limit": null,
      "is_loyalty_required": false,
      "loyalty_notes_ar": null,
      "loyalty_notes_en": null,
      "notes_ar": null,
      "notes_en": null,
      "bounding_box": {
        "x": 100,
        "y": 500,
        "width": 280,
        "height": 300
      },
      "confidence": 0.7,
      "warnings": ["LOW_CONFIDENCE_PRICE"]
    }
  ]
}
```

Expected app handling:

```json
{
  "import_row_status": "error",
  "error_code": "MISSING_OFFER_PRICE",
  "create_offer": false
}
```

The app should save the raw row and validation error but should not create a final offer.

## 14. Example: Missing Product Name

```json
{
  "items": [
    {
      "row_id": "page-4-item-2",
      "page_number": 4,
      "product_name_ar": null,
      "product_name_en": null,
      "brand_name_ar": "نادك",
      "brand_name_en": "NADEC",
      "category_name_ar": "الألبان",
      "category_name_en": "Dairy",
      "description_ar": null,
      "description_en": null,
      "offer_price": 12.95,
      "original_price": 15.95,
      "discount_text": null,
      "pack_size_value": 2,
      "pack_size_unit": "l",
      "pack_quantity": 1,
      "unit_price": null,
      "unit_price_unit": "l",
      "quantity_limit": null,
      "is_loyalty_required": false,
      "loyalty_notes_ar": null,
      "loyalty_notes_en": null,
      "notes_ar": null,
      "notes_en": null,
      "bounding_box": {
        "x": 420,
        "y": 500,
        "width": 280,
        "height": 300
      },
      "confidence": 0.66,
      "warnings": ["LOW_CONFIDENCE_PRODUCT_NAME"]
    }
  ]
}
```

Expected app handling:

```json
{
  "import_row_status": "error",
  "error_code": "MISSING_PRODUCT_NAME",
  "create_offer": false
}
```

## 15. Example: Missing Bounding Box

```json
{
  "items": [
    {
      "row_id": "page-4-item-3",
      "page_number": 4,
      "product_name_ar": "أرز بسمتي",
      "product_name_en": "Basmati Rice",
      "brand_name_ar": null,
      "brand_name_en": null,
      "category_name_ar": "المواد الغذائية الأساسية",
      "category_name_en": "Staples",
      "description_ar": null,
      "description_en": null,
      "offer_price": 39.95,
      "original_price": 49.95,
      "discount_text": null,
      "pack_size_value": 5,
      "pack_size_unit": "kg",
      "pack_quantity": 1,
      "unit_price": null,
      "unit_price_unit": "kg",
      "quantity_limit": null,
      "is_loyalty_required": false,
      "loyalty_notes_ar": null,
      "loyalty_notes_en": null,
      "notes_ar": null,
      "notes_en": null,
      "bounding_box": null,
      "confidence": 0.82,
      "warnings": ["MISSING_BOUNDING_BOX"]
    }
  ]
}
```

Expected app handling:

```json
{
  "import_row_status": "warning",
  "offer_status": "needs_review",
  "image_url": null,
  "create_offer": true
}
```

MVP rule:

* Missing image/bounding box should not necessarily block offer creation.
* The offer should become `needs_review` unless the setting `REQUIRE_IMAGE_FOR_DRAFT=true`.

## 16. Example: Invalid Original Price

```json
{
  "items": [
    {
      "row_id": "page-5-item-1",
      "page_number": 5,
      "product_name_ar": "قهوة سريعة التحضير",
      "product_name_en": "Instant Coffee",
      "brand_name_ar": null,
      "brand_name_en": null,
      "category_name_ar": "المشروبات",
      "category_name_en": "Beverages",
      "description_ar": null,
      "description_en": null,
      "offer_price": 25.95,
      "original_price": 20.95,
      "discount_text": null,
      "pack_size_value": 200,
      "pack_size_unit": "g",
      "pack_quantity": 1,
      "unit_price": null,
      "unit_price_unit": "g",
      "quantity_limit": null,
      "is_loyalty_required": false,
      "loyalty_notes_ar": null,
      "loyalty_notes_en": null,
      "notes_ar": null,
      "notes_en": null,
      "bounding_box": {
        "x": 100,
        "y": 500,
        "width": 300,
        "height": 300
      },
      "confidence": 0.77,
      "warnings": ["ORIGINAL_PRICE_LESS_THAN_OFFER_PRICE"]
    }
  ]
}
```

Expected app handling:

```json
{
  "import_row_status": "warning",
  "offer_status": "needs_review",
  "error_code": "ORIGINAL_PRICE_LESS_THAN_OFFER_PRICE",
  "create_offer": true
}
```

The app may create the offer as `needs_review`, but it must not calculate a negative discount.

## 17. Example: Loyalty Offer

```json
{
  "items": [
    {
      "row_id": "page-6-item-1",
      "page_number": 6,
      "product_name_ar": "مياه معدنية",
      "product_name_en": "Mineral Water",
      "brand_name_ar": null,
      "brand_name_en": null,
      "category_name_ar": "المشروبات",
      "category_name_en": "Beverages",
      "description_ar": "عبوة 6 حبات",
      "description_en": "6-pack",
      "offer_price": 8.95,
      "original_price": 11.95,
      "discount_text": null,
      "pack_size_value": 330,
      "pack_size_unit": "ml",
      "pack_quantity": 6,
      "unit_price": null,
      "unit_price_unit": "ml",
      "quantity_limit": null,
      "is_loyalty_required": true,
      "loyalty_notes_ar": "يتطلب بطاقة الولاء",
      "loyalty_notes_en": "Loyalty card required",
      "notes_ar": null,
      "notes_en": null,
      "bounding_box": {
        "x": 120,
        "y": 720,
        "width": 300,
        "height": 280
      },
      "confidence": 0.84,
      "warnings": []
    }
  ]
}
```

Expected app handling:

* `offers.is_loyalty_required = true`
* `offers.loyalty_notes_ar = "يتطلب بطاقة الولاء"`
* `offers.loyalty_notes_en = "Loyalty card required"`

## 18. Example: Normalized Import Row Shape

After OCR and local normalization, the app should store a consistent `normalized_data` object in `import_rows`.

Example:

```json
{
  "source": {
    "page_number": 1,
    "row_id": "page-1-item-1",
    "source_reference": "1+1"
  },
  "matched": {
    "product_id": null,
    "brand_id": null,
    "category_id": null,
    "duplicate_offer_id": null
  },
  "offer": {
    "title_ar": "حليب هايل بودرة",
    "title_en": "Haley Milk Powder",
    "offer_price": 62.95,
    "original_price": 125.9,
    "discount_amount": 62.95,
    "discount_percentage": 50,
    "pack_size_value": 1800,
    "pack_size_unit": "g",
    "pack_quantity": 2,
    "unit_price": 0.0175,
    "unit_price_unit": "g",
    "quantity_limit": null,
    "is_loyalty_required": false,
    "loyalty_notes_ar": null,
    "loyalty_notes_en": null,
    "notes_ar": "2 حبة",
    "notes_en": "2 PCS",
    "status": "draft",
    "data_quality_score": 90
  },
  "image": {
    "local_path": "imports/batch-123/crops/page-1-item-1.jpg",
    "storage_path": "offers/othaim/2025-05-27/batch-123/page-1/item-1.jpg",
    "image_url": "https://example.supabase.co/storage/v1/object/public/offer-images/offers/othaim/2025-05-27/batch-123/page-1/item-1.jpg"
  },
  "bounding_box": {
    "x": 120,
    "y": 450,
    "width": 300,
    "height": 300
  },
  "warnings": [],
  "errors": []
}
```

## 19. Example: Normalized Skipped Promotional Row

```json
{
  "source": {
    "page_number": 1,
    "row_id": "page-1-banner-1",
    "source_reference": "1+1 عروض تزين عيدك"
  },
  "matched": {
    "product_id": null,
    "brand_id": null,
    "category_id": null,
    "duplicate_offer_id": null
  },
  "offer": null,
  "image": null,
  "bounding_box": {
    "x": 0,
    "y": 0,
    "width": 1200,
    "height": 300
  },
  "skip_reason": "NON_PRODUCT_PROMOTIONAL_AREA",
  "warnings": [],
  "errors": [
    {
      "code": "NON_PRODUCT_PROMOTIONAL_AREA",
      "message": "Skipped page/banner promotional content because it is not a product offer."
    }
  ]
}
```

Expected database behavior:

```text
import_rows.status = skipped
created_offer_id = null
validation_errors.severity = info or warning
validation_errors.error_code = NON_PRODUCT_PROMOTIONAL_AREA
```

## 20. Example: Final Offer Insert Payload

This is a conceptual offer payload after OCR, normalization, matching, image upload, and duplicate checks.

```json
{
  "product_id": "matched-or-created-product-id",
  "supermarket_id": "selected-supermarket-id",
  "city_id": "selected-city-id",
  "region_id": null,
  "category_id": "matched-category-id",
  "brand_id": "matched-or-created-brand-id",
  "title_ar": "حليب هايل بودرة",
  "title_en": "Haley Milk Powder",
  "offer_price": 62.95,
  "original_price": 125.9,
  "discount_amount": 62.95,
  "discount_percentage": 50,
  "pack_size_value": 1800,
  "pack_size_unit": "g",
  "pack_quantity": 2,
  "unit_price": 0.0175,
  "unit_price_unit": "g",
  "offer_start_date": "2025-05-27",
  "offer_end_date": "2025-06-02",
  "status": "draft",
  "image_url": "https://example.supabase.co/storage/v1/object/public/offer-images/offers/othaim/2025-05-27/batch-123/page-1/item-1.jpg",
  "source_id": "offer-source-id",
  "source_page_number": 1,
  "source_reference": "1+1",
  "deal_score": null,
  "deal_label": null,
  "data_quality_score": 90,
  "is_loyalty_required": false,
  "loyalty_notes_ar": null,
  "loyalty_notes_en": null,
  "quantity_limit": null,
  "notes_ar": "2 حبة",
  "notes_en": "2 PCS"
}
```

Important:

* This is not direct OCR output.
* This is the final payload after app-side processing.
* IDs must come from actual DB matching/creation.
* Dates must come from user-selected import metadata.
* `status` should be `draft` or `needs_review`, not `published` by default.

## 21. Example: Validation Error Records

### Missing Offer Price

```json
{
  "severity": "error",
  "field_name": "offer_price",
  "error_code": "MISSING_OFFER_PRICE",
  "message": "Offer price is missing. This row cannot be imported as an offer."
}
```

### Missing Bounding Box

```json
{
  "severity": "warning",
  "field_name": "bounding_box",
  "error_code": "MISSING_BOUNDING_BOX",
  "message": "Bounding box is missing, so item image could not be cropped."
}
```

### Non-Product Promotional Area

```json
{
  "severity": "info",
  "field_name": "product_name_ar",
  "error_code": "NON_PRODUCT_PROMOTIONAL_AREA",
  "message": "Skipped campaign/banner content because it is not a product offer."
}
```

### Duplicate Offer

```json
{
  "severity": "info",
  "field_name": null,
  "error_code": "DUPLICATE_OFFER_DETECTED",
  "message": "Skipped row because a matching offer already exists for the same product, supermarket, location, dates, price, and pack data."
}
```

## 22. Test Fixture Files Antigravity Should Create

Antigravity should create test fixture files based on these examples.

Recommended location:

```text
src/shared/fixtures/
```

Recommended files:

```text
valid-ocr-response.json
empty-ocr-response.json
promotional-banner-response.json
missing-price-response.json
missing-product-name-response.json
missing-bounding-box-response.json
invalid-original-price-response.json
loyalty-offer-response.json
normalized-row-example.json
final-offer-payload-example.json
```

These fixtures should be used to test:

* Zod OCR schema validation.
* Non-product promotional filtering.
* Price validation.
* Bounding box validation.
* Normalization.
* Import row status mapping.
* Offer payload creation.

## 23. Zod Validation Expectations

The validation layer should accept:

* `items: []`
* Valid Arabic-only rows.
* Valid English-only rows.
* Mixed Arabic/English rows.
* `null` optional fields.
* Missing bounding box as warning.
* Missing original price as warning.
* Loyalty offer fields.
* Product offer rows with warnings.

The validation layer should reject or mark error:

* Missing top-level `items`.
* Non-array `items`.
* Missing page number.
* Invalid page number.
* Missing product name.
* Missing offer price.
* Invalid offer price.
* Invalid original price.
* Invalid bounding box shape.
* Confidence outside 0 to 1.
* `warnings` not being an array.

The filtering layer should skip:

* Campaign banners.
* Cover graphics.
* Generic promotion slogans.
* Date badges.
* Supermarket logo-only rows.
* Sponsor logo-only rows.
* Generic `1+1` rows without product offer data.

## 24. Final Principle

These examples are not just documentation.

They are test cases.

Antigravity should use them to build fixtures and automated checks so the app does not accidentally create bad Wifran offers from noisy OCR output.