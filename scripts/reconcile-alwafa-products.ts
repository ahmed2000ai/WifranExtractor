// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import dotenv from 'dotenv'
dotenv.config({ path: require('path').resolve(process.cwd(), '.env.local') })
import { Client } from 'pg'

async function reconcile() {
  console.log('=============================================================')
  console.log('RECONCILING ALWAFA_TEST PRODUCTS & CLEANING SYNTHETIC DATA')
  console.log('=============================================================\n')

  const client = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: (process.env.SUPABASE_DB_PASSWORD || ''),
    ssl: { rejectUnauthorized: false }
  })
  await client.connect()

  // 1. Remove synthetic test image from public.product_images
  console.log('--- 1. Cleaning Synthetic Images in public.product_images ---')
  // First clear FK on products
  await client.query(`
    UPDATE public.products
    SET approved_primary_image_id = NULL,
        default_image_url = NULL
    WHERE approved_primary_image_id IS NOT NULL;
  `)
  const delImg = await client.query('DELETE FROM public.product_images RETURNING id, storage_object_path')
  console.log(`Deleted ${delImg.rowCount} synthetic test rows from public.product_images:`)
  for (const r of delImg.rows) {
    console.log(`  - Deleted image record [${r.id}] (${r.storage_object_path})`)
  }

  // 2. Demote ambiguous non-food offers with brand conflict or lacking model identity
  console.log('\n--- 2. Demoting Ambiguous/Lacking-Model Offers to excluded_ambiguous ---')
  const demoteRes = await client.query(`
    UPDATE public.offers
    SET product_id = NULL,
        catalog_match_status = 'excluded_ambiguous',
        catalog_verification_basis = 'demoted_lacks_sku_or_brand_conflict',
        catalog_verified_by = NULL,
        catalog_verified_at = NULL
    WHERE supermarket_id = 'c2cc16c2-0008-4444-b000-c00000000008'
      AND (
        title_en ILIKE '%Flashlight%' OR
        title_en ILIKE '%Hair Trimmer%' OR
        title_en ILIKE '%Bed Sheet%'
      )
    RETURNING id, title_en, title_ar;
  `)
  console.log(`Demoted ${demoteRes.rowCount} offers:`)
  for (const d of demoteRes.rows) {
    console.log(`  - Demoted offer [${d.id}]: "${d.title_en}" / "${d.title_ar}"`)
  }

  // 3. Remove corresponding unverified rows from public.products
  console.log('\n--- 3. Removing Demoted Product Rows from public.products ---')
  const delProd = await client.query(`
    DELETE FROM public.products
    WHERE canonical_product_key ILIKE '%flashlight%'
       OR canonical_product_key ILIKE '%hair-trimmer%'
       OR canonical_product_key ILIKE '%bed-sheet%'
    RETURNING id, canonical_product_key;
  `)
  console.log(`Deleted ${delProd.rowCount} unverified product rows:`)
  for (const p of delProd.rows) {
    console.log(`  - Deleted product [${p.id}] (${p.canonical_product_key})`)
  }

  // 4. Refine item_name_complete for the 8 genuine, verified products
  console.log('\n--- 4. Updating Search-Ready item_name_complete on Verified Products ---')
  // We refine each verified product's item_name_complete with:
  // Brand + English name + Arabic name + explicit net size/pack
  const productsToUpdate = [
    {
      key: 'al-falah:al-falah-white-egg-small-30-s:std:30piece:1xeach',
      name_en: "Al Falah White Egg Small 30's",
      name_ar: 'بيض الفلاح أبيض صغير ٣٠ بيضة',
      item_name: "Al Falah White Egg Small 30's - بيض الفلاح أبيض صغير (30 Eggs Tray)"
    },
    {
      key: 'entaj:entaj-fresh-chicken-breast-fillet-450gm:std:450gram:1xeach',
      name_en: 'Entaj Fresh Chicken Breast Fillet 450g',
      name_ar: 'إنتاج فيليه صدور دجاج طازجة ٤٥٠ جرام',
      item_name: 'Entaj Fresh Chicken Breast Fillet 450g - إنتاج فيليه صدور دجاج طازجة (450 g)'
    },
    {
      key: 'entaj:entaj-fresh-chkn-portion-drumstick-450gm:std:450gram:1xeach',
      name_en: 'Entaj Fresh Chicken Drumsticks 450g',
      name_ar: 'إنتاج فريش دجاج بورشن ٤٥٠ جرام',
      item_name: 'Entaj Fresh Chicken Portion Drumstick 450g - إنتاج فريش دجاج بورشن (450 g)'
    },
    {
      key: 'ever-white:ever-white-washing-powder-10kg:std:10kilogram:1xeach',
      name_en: 'Ever White Washing Powder 10kg',
      name_ar: 'مسحوق غسيل إيفر وايت ١٠ كج',
      item_name: 'Ever White Washing Powder 10kg - مسحوق غسيل إيفر وايت (10 kg)'
    },
    {
      key: 'fakieh:fakieh-frozen-chicken-600gm:std:600gram:2xpack',
      name_en: 'Fakieh Frozen Chicken 600g',
      name_ar: 'دجاج فقيه مجمد ٦٠٠ ج',
      item_name: 'Fakieh Frozen Chicken 600g - دجاج فقيه مجمد (2 x 600 g Pack)'
    },
    {
      key: 'nadec:nadec-uht-milk-full-fat-4x1lt:std:1liter:4xpack',
      name_en: 'Nadec UHT Milk Full Fat 4x1L',
      name_ar: 'حليب نادك كامل الدسم طويل الأجل ٤ × ١ لتر',
      item_name: 'Nadec UHT Milk Full Fat 4x1L - حليب نادك كامل الدسم طويل الأجل (4 x 1 L)'
    },
    {
      key: 'tanmiah:tanmiah-fresh-chicken-bag:std:1000gram:1xeach',
      name_en: 'Tanmiah Fresh Chicken Bag 1000g',
      name_ar: 'دجاج تنمية طازج كيس',
      item_name: 'Tanmiah Fresh Chicken Bag 1000g - دجاج تنمية طازج كيس (1000 g)'
    },
    {
      key: 'tanmiah:tanmiah-fresh-chicken-bag:std:1100gram:1xeach',
      name_en: 'Tanmiah Fresh Chicken Bag 1100g',
      name_ar: 'دجاج تنمية طازج كيس',
      item_name: 'Tanmiah Fresh Chicken Bag 1100g - دجاج تنمية طازج كيس (1100 g)'
    }
  ]

  for (const item of productsToUpdate) {
    await client.query(`
      UPDATE public.products
      SET item_name_complete = $1,
          name_en = $2,
          name_ar = $3,
          verification_status = 'verified'
      WHERE canonical_product_key = $4;
    `, [item.item_name, item.name_en, item.name_ar, item.key])
    console.log(`  - Updated ${item.key} -> "${item.item_name}"`)
  }

  // 5. Verification Queries
  console.log('\n--- 5. Final State Verification ---')
  const prodCheck = await client.query(`
    SELECT id, canonical_product_key, item_name_complete, approved_primary_image_id
    FROM public.products
    ORDER BY id ASC;
  `)
  console.log(`Verified Products in DB: ${prodCheck.rows.length}`)
  for (const p of prodCheck.rows) {
    console.log(`  - [${p.id}] "${p.item_name_complete}" (approved_image: ${p.approved_primary_image_id || 'NONE'})`)
  }

  const offerCounts = await client.query(`
    SELECT catalog_match_status, count(*) as count
    FROM public.offers
    WHERE supermarket_id = 'c2cc16c2-0008-4444-b000-c00000000008' AND status = 'published'
    GROUP BY catalog_match_status;
  `)
  console.log('\nAlwafa Offer Status Breakdown:')
  for (const row of offerCounts.rows) {
    console.log(`  - ${row.catalog_match_status}: ${row.count}`)
  }

  const imgCheck = await client.query('SELECT count(*) FROM public.product_images;')
  console.log(`\nApproved Product Images Count: ${imgCheck.rows[0].count} (0 expected)`)

  await client.end()
}

reconcile().catch(err => {
  console.error('Reconciliation failed:', err)
  process.exit(1)
})

