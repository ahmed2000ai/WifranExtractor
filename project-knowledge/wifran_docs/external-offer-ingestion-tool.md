# External Offer Ingestion Tool Contract

## Overview
Wifran relies on an external data-ingestion tool to parse weekly supermarket leaflets, crop the individual offer images, optimize them, and securely insert the structured data into the Wifran database via Supabase.

This document details the expected data contract and recommended workflow for this tool.

## 1. Security & Authentication
- **Service Role Key**: The external tool must connect to the Wifran Supabase database using the `SUPABASE_SERVICE_ROLE_KEY`.
- **Server-Side Only**: This key must be kept absolutely secret and should only be used by trusted backend scripts or serverless environments. **Never expose the service role key in a client-side environment.**

## 2. Image Uploads
For each extracted item, the external tool must upload the cropped image to Supabase Storage.
- **Bucket**: `offer-images`
- **Path Format**: `{supermarket_slug}/{coverage_scope}/{location_slug}/{leaflet_id}/{item_number}.webp`
- **Format Requirements**: `webp` is highly recommended. Limit file sizes to 1-2 MB.

## 3. Database Updates
The tool must insert or update rows in the Wifran `offers` table. It should provide all available fields:

### Minimum Recommended Fields
- `supermarket_id` (UUID)
- `location_scope` ('national', 'region', 'city')
- `city_id` (UUID - required if scope is city)
- `region_id` (UUID - required if scope is region)
- `offer_source_id` (UUID - optional but recommended)
- `title_ar` / `title_en` (At least one required)
- `category_id` (UUID)
- `offer_price` (numeric)
- `original_price` (numeric)
- `offer_end_date` (Date string: YYYY-MM-DD)
- `status` (Default: `'needs_review'` until the tool is proven highly reliable)

### Offer Metadata Fields
- `image_url` (Public URL of the uploaded image)
- `image_path` (Storage path without bucket name)
- `image_source_type` ('external_tool', 'manual', etc.)
- `source_page_number` (Integer, the leaflet page)
- `source_item_number` (e.g., "001")
- `source_reference` (e.g., "Panda Weekly 2026-06-05")

## 4. Recommended Workflow
1. **Generate leaflet_id**:
   `{supermarket_slug}-{coverage_scope}-{location_slug}-{valid_to}`
2. **For each extracted item**:
   - Crop offer image.
   - Optimize to webp.
   - Name as `001.webp`, `002.webp`, etc.
   - Upload to `offer-images` bucket using the correct path.
3. **Get public image URL**.
4. **Create/find `offer_source` row** in the database with the `leaflet_id` and metadata.
5. **Insert offers** into the `offers` table referencing the `offer_source_id`, with the state set to `needs_review`.
6. **Admin reviews and publishes** the offers inside the Wifran dashboard.

## 5. Example Payload
```json
{
  "leaflet_id": "panda-city-riyadh-2026-06-05",
  "supermarket_slug": "panda",
  "coverage_scope": "city",
  "location_slug": "riyadh",
  "valid_to": "2026-06-05",
  "items": [
    {
      "source_item_number": "001",
      "source_page_number": 1,
      "title_ar": "أرز أبو كاس مزة هندي بسمتي ١٠ كجم",
      "title_en": "Abu Kass Indian Mazza Basmati Rice 10kg",
      "offer_price": 59.99,
      "original_price": 91.99,
      "pack_size_value": 10,
      "pack_size_unit": "kg",
      "image_path": "panda/city/riyadh/panda-city-riyadh-2026-06-05/001.webp",
      "image_url": "https://[PROJECT].supabase.co/storage/v1/object/public/offer-images/panda/city/riyadh/panda-city-riyadh-2026-06-05/001.webp"
    }
  ]
}
```
