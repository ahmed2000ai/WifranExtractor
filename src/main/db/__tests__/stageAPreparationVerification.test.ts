import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { createIsolatedWifranPostgres } from './isolatedPostgresHarness008'

const DANUBE_SUPERMARKET_ID = 'c2cc16c2-0004-4444-b000-c00000000004'

describe('Stage A Preparation Verification & Migration Integrity', () => {
  it('1. DEV Deployment Sequence: Applies Migration 011 then 012 then 013 in strict sequence', async () => {
    // Start isolated DB up to Migration 010 (representing current DEV state)
    const { db, client } = await createIsolatedWifranPostgres({ upToMigration: 10 })

    // Verify Migration 011 is not yet present
    const preDefRes = await client.query(`
      SELECT pg_get_viewdef('public.v_consumer_offers'::regclass, true) as viewdef;
    `)
    expect(preDefRes.rows[0].viewdef).not.toContain('candidate_pending_review')

    // Apply Migration 011
    const sql011 = fs.readFileSync(
      path.resolve(process.cwd(), 'project-knowledge/wifran_docs/011_wifran_mvp_candidate_consumer_visibility.sql'),
      'utf8'
    )
    await db.exec(sql011)

    // Verify 011 applied: view contains candidate_pending_review
    const post011Res = await client.query(`
      SELECT pg_get_viewdef('public.v_consumer_offers'::regclass, true) as viewdef;
    `)
    expect(post011Res.rows[0].viewdef).toContain('candidate_pending_review')

    // Apply Migration 012
    const sql012 = fs.readFileSync(
      path.resolve(process.cwd(), 'project-knowledge/wifran_docs/012_wifran_offer_display_image_precedence.sql'),
      'utf8'
    )
    await db.exec(sql012)

    // Verify 012 applied: view contains COALESCE(odi.public_url, pi.public_url)
    const post012Res = await client.query(`
      SELECT pg_get_viewdef('public.v_consumer_offers'::regclass, true) as viewdef;
    `)
    expect(post012Res.rows[0].viewdef).toContain('COALESCE(odi.public_url, pi.public_url)')

    // Apply Migration 013
    const sql013 = fs.readFileSync(
      path.resolve(process.cwd(), 'project-knowledge/wifran_docs/013_wifran_product_verification_defaults.sql'),
      'utf8'
    )
    await db.exec(sql013)

    // Verify 013 applied: check column defaults
    const defaultsRes = await client.query(`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products'
        AND column_name IN ('verification_status', 'verification_basis');
    `)
    const defMap = Object.fromEntries(defaultsRes.rows.map(r => [r.column_name, r.column_default]))
    expect(defMap.verification_status).toContain('candidate')
    expect(defMap.verification_basis).toContain('auto_extraction_provisional')

    await db.close()
  })

  it('2. PROD Deployment Sequence: Preserves existing Migration 011 and applies 012 and 013 safely', async () => {
    // Start isolated DB up to Migration 011 (representing current PROD state)
    const { db, client } = await createIsolatedWifranPostgres({ upToMigration: 11 })

    // Insert category and brand
    await client.query(`
      INSERT INTO public.categories (id, name_ar, name_en, slug)
      VALUES ('00000000-0000-0000-0000-000000000c01', 'أرز', 'Rice', 'rice')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.brands (id, name_ar, name_en, slug)
      VALUES ('00000000-0000-0000-0000-000000000b01', 'الشعلان', 'Al Shalan', 'al-shalan')
      ON CONFLICT (id) DO NOTHING;
    `)

    // Insert product without explicit ID (identity column)
    const prodRes = await client.query(`
      INSERT INTO public.products (
        brand_id, category_id, name_ar, name_en,
        brand_name, inner_pack_count, each_size_value, each_size_unit,
        verification_status, is_active
      ) VALUES (
        '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000c01',
        'أرز سيلا بسمتي 5 كجم', 'Sella Basmati Rice 5kg',
        'Al Shalan', 1, 5, 'kg', 'candidate', true
      ) RETURNING id;
    `)
    const prodId = prodRes.rows[0].id

    await client.query(`
      INSERT INTO public.offers (
        id, supermarket_id, source_offer_id, source_revision, contract_version,
        product_id, title_ar, title_en, offer_price, original_price,
        offer_start_date, offer_end_date,
        catalog_match_status, exact_identity_status, assortment_status,
        status
      ) VALUES (
        '00000000-0000-0000-0000-000000000901', $1, 'src_prod_001', 1, '2.0',
        $2, 'أرز الشعلان 5 كجم', 'Al Shalan Rice 5kg', 34.95, 45.00,
        '2026-11-01', '2026-11-30',
        'candidate_pending_review', 'unresolved', 'single_item',
        'published'
      );
    `, [DANUBE_SUPERMARKET_ID, prodId])

    // Pre-012 query: offer is visible under 011
    const pre012Res = await client.query(`
      SELECT id, title_ar, brand_name_en, product_id, image_url
      FROM public.v_consumer_offers
      WHERE id = '00000000-0000-0000-0000-000000000901';
    `)
    expect(pre012Res.rows.length).toBe(1)
    expect(pre012Res.rows[0].brand_name_en).toBe('Al Shalan')
    expect(pre012Res.rows[0].image_url).toBeNull()

    // Apply Migration 012
    const sql012 = fs.readFileSync(
      path.resolve(process.cwd(), 'project-knowledge/wifran_docs/012_wifran_offer_display_image_precedence.sql'),
      'utf8'
    )
    await db.exec(sql012)

    // Apply Migration 013
    const sql013 = fs.readFileSync(
      path.resolve(process.cwd(), 'project-knowledge/wifran_docs/013_wifran_product_verification_defaults.sql'),
      'utf8'
    )
    await db.exec(sql013)

    // Verify existing offer is still 100% visible and preserved
    const post013Res = await client.query(`
      SELECT id, title_ar, brand_name_en, product_id, image_url
      FROM public.v_consumer_offers
      WHERE id = '00000000-0000-0000-0000-000000000901';
    `)
    expect(post013Res.rows.length).toBe(1)
    expect(post013Res.rows[0].brand_name_en).toBe('Al Shalan')

    await db.close()
  })

  it('3. Product Verification Defaults & Positive Constraints (Migration 013)', async () => {
    const { db, client } = await createIsolatedWifranPostgres({ upToMigration: 13 })

    // Insert product without explicit verification_status and verification_basis
    const insRes = await client.query(`
      INSERT INTO public.products (
        name_ar, name_en, brand_name,
        inner_pack_count, each_size_value, each_size_unit
      ) VALUES (
        'حليب طازج 2 لتر', 'Fresh Milk 2L', 'Almarai',
        1, 2, 'l'
      ) RETURNING id, verification_status, verification_basis;
    `)
    expect(insRes.rows[0].verification_status).toBe('candidate')
    expect(insRes.rows[0].verification_basis).toBe('auto_extraction_provisional')

    // Constraint rejection: negative size value
    await expect(
      client.query(`
        INSERT INTO public.products (
          name_ar, name_en, each_size_value
        ) VALUES ('منتج غير صالح', 'Invalid Product', -5);
      `)
    ).rejects.toThrow(/chk_products_positive_size/)

    // Constraint rejection: zero inner pack count
    await expect(
      client.query(`
        INSERT INTO public.products (
          name_ar, name_en, inner_pack_count
        ) VALUES ('منتج غير صالح', 'Invalid Product', 0);
      `)
    ).rejects.toThrow(/chk_products_positive_inner_count/)

    await db.close()
  })

  it('4. Image Precedence & Accurate Provenance Classification (Migration 012)', async () => {
    const { db, client } = await createIsolatedWifranPostgres({ upToMigration: 13 })

    // Verify offer_display_images accepts 'promotional_leaflet_crop' and 'leaflet_crop'
    const testOfferId = '00000000-0000-0000-0000-000000000902'
    await client.query(`
      INSERT INTO public.offers (
        id, supermarket_id, source_offer_id, source_revision, contract_version,
        title_ar, title_en, offer_price, status,
        offer_start_date, offer_end_date,
        assortment_status,
        contract_v2
      ) VALUES (
        $1, $2, 'src_img_test_001', 1, '2.0',
        'دجاج بروستد ساديا', 'Sadia Broasted Chicken', 15.95, 'published',
        '2026-11-01', '2026-11-30',
        'multiple_variants',
        '{"assets":{"offer_card":{"upload_state":"pending"},"product_thumbnail":{"upload_state":"pending"}}}'::jsonb
      );
    `, [testOfferId, DANUBE_SUPERMARKET_ID])

    // Insert with promotional_leaflet_crop
    const insCrop = await client.query(`
      INSERT INTO public.offer_display_images (
        offer_id, storage_bucket, storage_object_path, public_url,
        mime_type, byte_size, content_sha256, source_kind, visual_subject_key,
        approval_status
      ) VALUES (
        $1, 'offer-display-images', 'offers/sadia_crop.webp',
        'https://cdn.wifran/offer-display-images/offers/sadia_crop.webp',
        'image/webp', 2048, 'sha_crop_01', 'promotional_leaflet_crop', 'sadia_key',
        'approved'
      ) RETURNING id, source_kind;
    `, [testOfferId])
    expect(insCrop.rows[0].source_kind).toBe('promotional_leaflet_crop')

    // Constraint rejection: invalid source_kind
    await expect(
      client.query(`
        INSERT INTO public.offer_display_images (
          offer_id, storage_bucket, storage_object_path, public_url,
          mime_type, byte_size, content_sha256, source_kind, visual_subject_key
        ) VALUES (
          $1, 'offer-display-images', 'offers/bad.webp',
          'https://cdn.wifran/offer-display-images/offers/bad.webp',
          'image/webp', 2048, 'sha_bad', 'unapproved_web_scrape', 'bad_key'
        );
      `, [testOfferId])
    ).rejects.toThrow(/offer_display_images_source_kind_check/)

    // Check v_consumer_offers projection for assortment offer with promotional_leaflet_crop
    const viewRes = await client.query(`
      SELECT
        id, image_url, display_image_url, display_image_kind,
        card_image_subject_scope, card_image_upload_state,
        consumer_contract_v2
      FROM public.v_consumer_offers
      WHERE id = $1;
    `, [testOfferId])

    expect(viewRes.rows.length).toBe(1)
    const row = viewRes.rows[0]
    expect(row.image_url).toBe('https://cdn.wifran/offer-display-images/offers/sadia_crop.webp')
    expect(row.display_image_url).toBe('https://cdn.wifran/offer-display-images/offers/sadia_crop.webp')
    expect(row.display_image_kind).toBe('illustrative')
    expect(row.card_image_subject_scope).toBe('representative_assortment')
    expect(row.card_image_upload_state).toBe('uploaded')
    expect(row.consumer_contract_v2.assets.offer_card.delivery_url).toBe(
      'https://cdn.wifran/offer-display-images/offers/sadia_crop.webp'
    )
    expect(row.consumer_contract_v2.assets.offer_card.subject_scope).toBe('representative_assortment')

    await db.close()
  })

  it('5. Consumer View Precedence: offer_display_images takes precedence over product_images', async () => {
    const { db, client } = await createIsolatedWifranPostgres({ upToMigration: 13 })

    const testOfferId = '00000000-0000-0000-0000-000000000903'

    // Create product and capture ID
    const prodRes = await client.query(`
      INSERT INTO public.products (
        name_ar, name_en, verification_status, is_active
      ) VALUES (
        'أرز 5 كجم', 'Rice 5kg', 'candidate', true
      ) RETURNING id;
    `)
    const prodId = prodRes.rows[0].id

    // Create primary product image
    await client.query(`
      INSERT INTO public.product_images (
        product_id, storage_bucket, storage_object_path, public_url,
        source_url, normalized_source_url, mime_type, byte_size, content_sha256, role, approval_status
      ) VALUES (
        $1, 'product-images', 'products/p903.webp',
        'https://cdn.wifran/product-images/products/p903.webp',
        'https://example.com/p903.jpg', 'https://example.com/p903.jpg',
        'image/webp', 1024, 'sha_pi', 'primary', 'approved'
      );
    `, [prodId])

    // Create offer
    await client.query(`
      INSERT INTO public.offers (
        id, supermarket_id, source_offer_id, source_revision, contract_version,
        product_id, title_ar, title_en, offer_price, status,
        offer_start_date, offer_end_date,
        catalog_match_status, assortment_status
      ) VALUES (
        $1, $2, 'src_prec_test', 1, '2.0',
        $3, 'عرض أرز خاص', 'Special Rice Offer', 29.95, 'published',
        '2026-11-01', '2026-11-30',
        'candidate_pending_review', 'single_item'
      );
    `, [testOfferId, DANUBE_SUPERMARKET_ID, prodId])

    // Before inserting offer_display_images: catalog image is served
    const preOdiRes = await client.query(`
      SELECT image_url, display_image_kind, card_image_subject_scope
      FROM public.v_consumer_offers
      WHERE id = $1;
    `, [testOfferId])
    expect(preOdiRes.rows[0].image_url).toBe('https://cdn.wifran/product-images/products/p903.webp')
    expect(preOdiRes.rows[0].display_image_kind).toBe('exact_product')
    expect(preOdiRes.rows[0].card_image_subject_scope).toBe('product_package')

    // Now insert approved offer_display_images (e.g. operator promotional crop)
    await client.query(`
      INSERT INTO public.offer_display_images (
        offer_id, storage_bucket, storage_object_path, public_url,
        mime_type, byte_size, content_sha256, source_kind, visual_subject_key,
        approval_status
      ) VALUES (
        $1, 'offer-display-images', 'offers/custom_crop.webp',
        'https://cdn.wifran/offer-display-images/offers/custom_crop.webp',
        'image/webp', 2048, 'sha_crop_custom', 'promotional_leaflet_crop', 'custom_key',
        'approved'
      );
    `, [testOfferId])

    // Under Migration 012: offer_display_images takes precedence!
    const postOdiRes = await client.query(`
      SELECT image_url, display_image_kind, card_image_subject_scope
      FROM public.v_consumer_offers
      WHERE id = $1;
    `, [testOfferId])
    expect(postOdiRes.rows[0].image_url).toBe('https://cdn.wifran/offer-display-images/offers/custom_crop.webp')
    expect(postOdiRes.rows[0].display_image_kind).toBe('exact_product') // single_item with product_id
    expect(postOdiRes.rows[0].card_image_subject_scope).toBe('product_package')

    await db.close()
  })

  it('6. Consumer View Signature: Exactly 98 columns matching consumer application contract', async () => {
    const { db, client } = await createIsolatedWifranPostgres({ upToMigration: 13 })

    const colsRes = await client.query(`
      SELECT column_name, data_type, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'v_consumer_offers'
      ORDER BY ordinal_position;
    `)

    expect(colsRes.rows.length).toBe(98)

    // Verify key contract columns
    const colNames = colsRes.rows.map(r => r.column_name)
    expect(colNames).toContain('id')
    expect(colNames).toContain('source_offer_id')
    expect(colNames).toContain('product_id')
    expect(colNames).toContain('image_url')
    expect(colNames).toContain('display_image_url')
    expect(colNames).toContain('display_image_kind')
    expect(colNames).toContain('card_image_subject_scope')
    expect(colNames).toContain('card_image_upload_state')
    expect(colNames).toContain('consumer_contract_v2')
    expect(colNames).toContain('brand_name_en')
    expect(colNames).toContain('brand_candidate_text')

    // Verify SELECT permission granted to anon and authenticated
    const permsRes = await client.query(`
      SELECT grantee, privilege_type
      FROM information_schema.table_privileges
      WHERE table_schema = 'public' AND table_name = 'v_consumer_offers'
        AND privilege_type = 'SELECT';
    `)
    const grantees = permsRes.rows.map(r => r.grantee)
    expect(grantees).toContain('anon')
    expect(grantees).toContain('authenticated')

    await db.close()
  })

  it('7. Rollback Integrity: Migration 013 and 012 rollbacks cleanly restore prior states', async () => {
    const { db, client } = await createIsolatedWifranPostgres({ upToMigration: 13 })

    // Execute Migration 013 Rollback
    const sql013Rollback = fs.readFileSync(
      path.resolve(process.cwd(), 'project-knowledge/wifran_docs/013_wifran_product_verification_defaults_rollback.sql'),
      'utf8'
    )
    await db.exec(sql013Rollback)

    // Verify 013 rollback: defaults restored to 'verified' and constraints removed
    const post013RollbackDefaults = await client.query(`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products'
        AND column_name IN ('verification_status', 'verification_basis');
    `)
    const defMap = Object.fromEntries(post013RollbackDefaults.rows.map(r => [r.column_name, r.column_default]))
    expect(defMap.verification_status).toContain('verified')
    expect(defMap.verification_basis).toContain('operator_verified_pack_identity')

    const constraintsRes = await client.query(`
      SELECT conname FROM pg_constraint WHERE conname IN ('chk_products_positive_size', 'chk_products_positive_inner_count');
    `)
    expect(constraintsRes.rows.length).toBe(0)

    // Execute Migration 012 Rollback
    const sql012Rollback = fs.readFileSync(
      path.resolve(process.cwd(), 'project-knowledge/wifran_docs/012_wifran_offer_display_image_precedence_rollback.sql'),
      'utf8'
    )
    await db.exec(sql012Rollback)

    // Verify 012 rollback: view definition restored to 011 precedence (pi.public_url takes precedence over odi)
    const post012RollbackView = await client.query(`
      SELECT pg_get_viewdef('public.v_consumer_offers'::regclass, true) as viewdef;
    `)
    expect(post012RollbackView.rows[0].viewdef).toContain('COALESCE(pi.public_url, odi.public_url)')

    // Verify constraint restored
    await expect(
      client.query(`
        INSERT INTO public.offer_display_images (
          offer_id, storage_bucket, storage_object_path, public_url,
          mime_type, byte_size, content_sha256, source_kind, visual_subject_key
        ) VALUES (
          '00000000-0000-0000-0000-000000000001', 'b', 'p', 'u',
          'm', 1, 's', 'promotional_leaflet_crop', 'k'
        );
      `)
    ).rejects.toThrow(/offer_display_images_source_kind_check/)

    await db.close()
  })

  it('8. Migration 012 Rollback Precondition: Fails closed when promotional_leaflet_crop rows exist, preventing data loss', async () => {
    const { db, client } = await createIsolatedWifranPostgres({ upToMigration: 13 })

    // Insert an offer and a display image with promotional_leaflet_crop
    const testOfferId = '00000000-0000-0000-0000-000000000999'
    await client.query(`
      INSERT INTO public.offers (
        id, supermarket_id, source_offer_id, source_revision, contract_version,
        title_ar, title_en, offer_price, status,
        offer_start_date, offer_end_date,
        assortment_status
      ) VALUES (
        $1, $2, 'src_rb_test', 1, '2.0',
        'عرض تجريبي للتراجع', 'Rollback Test Offer', 10.00, 'published',
        '2026-11-01', '2026-11-30',
        'single_item'
      );
    `, [testOfferId, DANUBE_SUPERMARKET_ID])

    await client.query(`
      INSERT INTO public.offer_display_images (
        offer_id, storage_bucket, storage_object_path, public_url,
        mime_type, byte_size, content_sha256, source_kind, visual_subject_key,
        approval_status
      ) VALUES (
        $1, 'offer-display-images', 'offers/crop999.webp',
        'https://cdn.wifran/offer-display-images/offers/crop999.webp',
        'image/webp', 1024, 'sha_rb', 'promotional_leaflet_crop', 'k999',
        'approved'
      );
    `, [testOfferId])

    // Condition B: Attempting to run full rollback with promotional_leaflet_crop present
    const sql012Rollback = fs.readFileSync(
      path.resolve(process.cwd(), 'project-knowledge/wifran_docs/012_wifran_offer_display_image_precedence_rollback.sql'),
      'utf8'
    )

    // Must fail closed with explicit precondition block!
    try {
      await db.exec(sql012Rollback)
      expect.fail('Expected rollback to fail precondition check')
    } catch (err: any) {
      expect(err.message).toMatch(/ROLLBACK PRECONDITION BLOCKED/)
      await db.exec('ROLLBACK;')
    }

    // Confirm the valid row was NOT deleted or mutated
    const checkRow = await client.query(`
      SELECT source_kind, public_url FROM public.offer_display_images WHERE offer_id = $1;
    `, [testOfferId])
    expect(checkRow.rows.length).toBe(1)
    expect(checkRow.rows[0].source_kind).toBe('promotional_leaflet_crop')

    // View-Only Rollback verification: operator executes 012_wifran_offer_display_image_view_only_rollback.sql
    const sqlViewOnlyRollback = fs.readFileSync(
      path.resolve(process.cwd(), 'project-knowledge/wifran_docs/012_wifran_offer_display_image_view_only_rollback.sql'),
      'utf8'
    )
    await db.exec(sqlViewOnlyRollback)

    // View successfully reverts to Migration 011 precedence while preserving promotional_leaflet_crop row & constraint!
    const checkViewAfter = await client.query(`
      SELECT image_url, display_image_kind, card_image_subject_scope
      FROM public.v_consumer_offers
      WHERE id = $1;
    `, [testOfferId])
    expect(checkViewAfter.rows.length).toBe(1)
    expect(checkViewAfter.rows[0].image_url).toBe('https://cdn.wifran/offer-display-images/offers/crop999.webp')
    expect(checkViewAfter.rows[0].display_image_kind).toBe('illustrative') // under 011 logic without product_image

    const checkRowAfter = await client.query(`
      SELECT source_kind FROM public.offer_display_images WHERE offer_id = $1;
    `, [testOfferId])
    expect(checkRowAfter.rows[0].source_kind).toBe('promotional_leaflet_crop')

    await db.close()
  })
})
