# Offer Images Bucket

## Overview
Wifran stores all offer item images in a dedicated Supabase Storage bucket named `offer-images`. These are public images that correspond to a specific item from a weekly supermarket leaflet.

## Bucket Configuration
- **Bucket name**: `offer-images`
- **Public read**: Yes. (Offer item images are public leaflet/offer images displayed to users).
- **Upload access**: Restricted. Only the Service Role (trusted server-side tools) or authenticated Admins can upload, modify, or delete files.

## Accepted File Types & Recommendations
- **Allowed file types**: `image/webp`, `image/jpeg`, `image/png`
- **Recommended format**: `webp` (for optimal performance and quality)
- **Recommended max image size**: 1–2 MB
- **Recommended dimensions**: 600–1200px wide
- **Recommended crop**: The image should be cropped directly from the leaflet to include the product, the offer price, the original price, and any relevant pack size details. It must not be just a generic product stock photo.

## Path Structure
Files uploaded to this bucket must adhere strictly to the following path structure:
`{supermarket_slug}/{coverage_scope}/{location_slug}/{leaflet_id}/{item_number}.webp`

### Example Paths
- `panda/city/riyadh/panda-riyadh-2026-06-05/001.webp`
- `othaim/region/riyadh-region/othaim-riyadh-region-2026-06-05/001.webp`
- `carrefour/national/saudi-arabia/carrefour-national-2026-06-05/001.webp`

## Security Considerations
Since these images are public marketing assets, making the bucket public-read avoids the overhead of signing URLs. However, any modification (upload, replace, delete) requires secure credentials. **Never expose the `SUPABASE_SERVICE_ROLE_KEY` to the client-side or any untrusted environments.**
