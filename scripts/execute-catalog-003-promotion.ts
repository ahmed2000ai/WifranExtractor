import { Client } from 'pg'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

export interface PromotionOptions {
  includeNadecImage?: boolean
}

export async function executeCatalog003Promotion(options: PromotionOptions = {}) {
  const client = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || '',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  })

  await client.connect()
  await client.query('SET statement_timeout = 20000')

  try {
    await client.query('BEGIN')

    console.log('=== EXECUTING CATALOG-003 CONTROLLED PROMOTION ===\n')

    // 1. Verify baseline counts inside transaction
    const baseCountRes = await client.query(`
      SELECT 
        count(*)::int AS total_offers,
        count(CASE WHEN product_id IS NOT NULL THEN 1 END)::int AS verified_links
      FROM public.offers;
    `)
    const { total_offers: initialOffers, verified_links: initialLinks } = baseCountRes.rows[0]
    console.log(`Initial DB State: ${initialOffers} total offers, ${initialLinks} verified links.`)

    const baseProdRes = await client.query('SELECT count(*)::int AS total_products FROM public.products;')
    const initialProducts = baseProdRes.rows[0].total_products
    console.log(`Initial Products: ${initialProducts} total products.`)

    const baseImgRes = await client.query('SELECT count(*)::int AS total_images FROM public.product_images;')
    const initialImages = baseImgRes.rows[0].total_images
    console.log(`Initial Images: ${initialImages} total images.`)

    if (initialOffers !== 93 || initialLinks !== 8 || initialProducts !== 8 || initialImages !== 7) {
      throw new Error(
        `Baseline mismatch! Expected 93 offers, 8 links, 8 products, 7 images. Found ${initialOffers}/${initialLinks}/${initialProducts}/${initialImages}. Aborting.`
      )
    }

    // 2. Insert the three verified catalog products
    const verifiedBy = 'wifran_operator'
    const verificationBasis = 'operator_verified_pack_identity'
    const verifiedAt = new Date().toISOString()

    // A. Product 1: Nestle Pure Life Water 330ml x 40
    console.log('Inserting/Upserting Product 1: Nestle Pure Life Water 330ml x 40...')
    const prod1Res = await client.query(`
      INSERT INTO public.products (
        canonical_product_key, item_name_complete, name_en, name_ar, brand_name,
        each_size_value, each_size_unit, inner_pack_count, sale_unit_type,
        verification_status, verification_basis, verified_by, verified_at, slug
      ) VALUES (
        'nestle:nestle-pure-life-water-330ml-x-40:std:330ml:40xpack',
        'Nestle Pure Life Water 330ml x 40 - نستله مياه بيور لايف 330 مل × 40',
        'Nestle Pure Life Water 330ml x 40', 'نستله مياه بيور لايف 330 مل × 40', 'Nestle',
        330, 'ml', 40, 'pack',
        'verified', '${verificationBasis}', '${verifiedBy}', '${verifiedAt}',
        'nestle-pure-life-water-330ml-x-40'
      )
      ON CONFLICT (canonical_product_key) DO UPDATE
      SET item_name_complete = EXCLUDED.item_name_complete
      RETURNING id;
    `)
    const prodNestleId = prod1Res.rows[0].id
    console.log(`Product 1 ID: ${prodNestleId}`)

    // B. Product 2: Nadec Cooking Cream 1L
    console.log('Inserting/Upserting Product 2: Nadec Cooking Cream 1L...')
    const prod2Res = await client.query(`
      INSERT INTO public.products (
        canonical_product_key, item_name_complete, name_en, name_ar, brand_name,
        variant_or_flavor, each_size_value, each_size_unit, inner_pack_count, sale_unit_type,
        verification_status, verification_basis, verified_by, verified_at, slug
      ) VALUES (
        'nadec:nadec-cooking-cream-1l:cooking:1l:1xeach',
        'Nadec Cooking Cream 1L - نادك كريمة للطبخ 1 لتر',
        'Nadec Cooking Cream 1L', 'نادك كريمة للطبخ 1 لتر', 'Nadec',
        'cooking', 1, 'l', 1, 'each',
        'verified', '${verificationBasis}', '${verifiedBy}', '${verifiedAt}',
        'nadec-cooking-cream-1l'
      )
      ON CONFLICT (canonical_product_key) DO UPDATE
      SET item_name_complete = EXCLUDED.item_name_complete
      RETURNING id;
    `)
    const prodNadecId = prod2Res.rows[0].id
    console.log(`Product 2 ID: ${prodNadecId}`)

    // C. Product 3: Sadia Frozen Chicken 10x900g
    console.log('Inserting/Upserting Product 3: Sadia Frozen Chicken 10x900g...')
    const prod3Res = await client.query(`
      INSERT INTO public.products (
        canonical_product_key, item_name_complete, name_en, name_ar, brand_name,
        variant_or_flavor, each_size_value, each_size_unit, inner_pack_count, sale_unit_type,
        verification_status, verification_basis, verified_by, verified_at, slug
      ) VALUES (
        'sadia:sadia-frozen-chicken-10x900g:whole:900g:10xpack',
        'Sadia Frozen Chicken 10x900g - ساديا دجاج مجمد 900 جرام × 10',
        'Sadia Frozen Chicken 10x900g', 'ساديا دجاج مجمد 900 جرام × 10', 'Sadia',
        'whole', 900, 'g', 10, 'pack',
        'verified', '${verificationBasis}', '${verifiedBy}', '${verifiedAt}',
        'sadia-frozen-chicken-10x900g'
      )
      ON CONFLICT (canonical_product_key) DO UPDATE
      SET item_name_complete = EXCLUDED.item_name_complete
      RETURNING id;
    `)
    const prodSadiaId = prod3Res.rows[0].id
    console.log(`Product 3 ID: ${prodSadiaId}`)

    // 3. Link the 3 Carrefour offers
    console.log('\nLinking offers to verified products...')

    // Offer 1 -> Nestle Water
    await client.query(`
      UPDATE public.offers
      SET product_id = ${prodNestleId},
          catalog_candidate_key = 'nestle:nestle-pure-life-water-330ml-x-40:std:330ml:40xpack',
          catalog_match_status = 'verified_linked',
          catalog_verification_basis = '${verificationBasis}',
          catalog_verified_by = '${verifiedBy}',
          catalog_verified_at = '${verifiedAt}'
      WHERE id = '4c2432de-99ac-4447-b150-43e5c7ede1d1';
    `)

    // Offer 2 -> Nadec Cream
    await client.query(`
      UPDATE public.offers
      SET product_id = ${prodNadecId},
          catalog_candidate_key = 'nadec:nadec-cooking-cream-1l:cooking:1l:1xeach',
          catalog_match_status = 'verified_linked',
          catalog_verification_basis = '${verificationBasis}',
          catalog_verified_by = '${verifiedBy}',
          catalog_verified_at = '${verifiedAt}'
      WHERE id = '36f4d30d-9801-441d-8803-4216ed837aac';
    `)

    // Offer 3 -> Sadia Chicken
    await client.query(`
      UPDATE public.offers
      SET product_id = ${prodSadiaId},
          catalog_candidate_key = 'sadia:sadia-frozen-chicken-10x900g:whole:900g:10xpack',
          catalog_match_status = 'verified_linked',
          catalog_verification_basis = '${verificationBasis}',
          catalog_verified_by = '${verifiedBy}',
          catalog_verified_at = '${verifiedAt}'
      WHERE id = 'ce862ad4-b563-4080-aa76-a2f4fffb40fd';
    `)

    // 4. Handle Nadec image if explicitly authorized
    let nadecImageId: string | null = null
    if (options.includeNadecImage) {
      console.log('Attaching approved image to Nadec Cooking Cream (authorized)...')
      const nadecSha256 = '3822508b2ddb94626a7375f7aee59df5e7aef0b4712603c64a436c24a62f3f15'
      const nadecPublicUrl = `https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/product-images/catalog/${nadecSha256}.jpg`

      const imgRes = await client.query(`
        INSERT INTO public.product_images (
          product_id, role, storage_bucket, storage_object_path, public_url,
          mime_type, byte_size, content_sha256, source_url, normalized_source_url,
          approval_status, rights_basis, reviewed_by, reviewed_at
        ) VALUES (
          ${prodNadecId}, 'primary', 'product-images', 'catalog/${nadecSha256}.jpg', '${nadecPublicUrl}',
          'image/jpeg', 1192975, '${nadecSha256}',
          'https://images.openfoodfacts.org/images/products/628/105/700/5505/front_en.3.full.jpg',
          'https://images.openfoodfacts.org/images/products/628/105/700/5505/front_en.3.full.jpg',
          'approved', 'openfoodfacts_cc_by_sa', '${verifiedBy}', '${verifiedAt}'
        )
        ON CONFLICT DO NOTHING
        RETURNING id;
      `)
      if (imgRes.rows.length > 0) {
        nadecImageId = imgRes.rows[0].id
        await client.query(`
          UPDATE public.products
          SET approved_primary_image_id = '${nadecImageId}',
              default_image_url = '${nadecPublicUrl}'
          WHERE id = ${prodNadecId};
        `)
      }
    } else {
      console.log('Nadec image withheld from live upload (image-free promotion).')
    }

    // 5. Post-operation verification inside transaction
    const postCountRes = await client.query(`
      SELECT 
        count(*)::int AS total_offers,
        count(CASE WHEN product_id IS NOT NULL THEN 1 END)::int AS verified_links
      FROM public.offers;
    `)
    const { total_offers: finalOffers, verified_links: finalLinks } = postCountRes.rows[0]
    console.log(`\nPost-Operation Counts: ${finalOffers} total offers (Expected: 93), ${finalLinks} verified links (Expected: 11).`)

    const postProdCountRes = await client.query('SELECT count(*)::int AS total_products FROM public.products;')
    const finalProducts = postProdCountRes.rows[0].total_products
    console.log(`Total Products: ${finalProducts} (Expected: 11).`)

    const postImgCountRes = await client.query('SELECT count(*)::int AS total_images FROM public.product_images;')
    const finalImages = postImgCountRes.rows[0].total_images
    console.log(`Total Images: ${finalImages} (Expected: 7).`)

    // Verify Noori offers were not touched
    const nooriCheck = await client.query(`
      SELECT count(*)::int AS noori_count
      FROM public.offers
      WHERE id IN (
        'fd865e4e-e9cb-444a-b71a-80c74efc16e4',
        '2ec312c1-634e-4bc0-98f4-ca45681e2a27',
        '3b3915b7-702b-41c0-95e3-464e8fa3b90f'
      ) AND product_id IS NULL;
    `)
    if (nooriCheck.rows[0].noori_count !== 3) {
      throw new Error('Noori offers were modified! Rolling back.')
    }
    console.log('Noori offers verified untouched (3/3 intact with product_id = NULL).')

    if (finalOffers !== 93 || finalLinks !== 11 || finalProducts !== 11 || finalImages !== 7) {
      throw new Error(
        `Post-operation verification failed! Found ${finalOffers} offers, ${finalLinks} links, ${finalProducts} products, ${finalImages} images. Rolling back.`
      )
    }

    await client.query('COMMIT')
    console.log('\n=== TRANSACTION COMMITTED SUCCESSFULLY ===')

    return {
      success: true,
      productIds: {
        nestle: prodNestleId,
        nadec: prodNadecId,
        sadia: prodSadiaId
      },
      nadecImageId,
      finalOffers,
      finalLinks,
      finalProducts,
      finalImages
    }
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Promotion error (rolled back):', err)
    throw err
  } finally {
    await client.end()
  }
}

if (process.argv[1]?.includes('execute-catalog-003-promotion')) {
  executeCatalog003Promotion({ includeNadecImage: false })
    .then((res) => {
      console.log('\nPromotion Result:', JSON.stringify(res, null, 2))
      process.exit(0)
    })
    .catch((err) => {
      console.error('\nPromotion execution fatal error:', err)
      process.exit(1)
    })
}

