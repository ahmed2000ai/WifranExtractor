import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver';
assertProductionMaintenanceAuthorized(__filename);
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
  const client = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || '',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const res = await client.query(`
    SELECT o.id, o.source_offer_id, o.title_en, o.title_ar, o.product_id,
           o.catalog_match_status, o.exact_identity_status, o.assortment_status,
           o.known_options, o.unit_price, o.unit_price_unit, o.image_subject_scope,
           o.image_url, o.thumbnail_url, o.reason_codes, o.scoped_assessments,
           pi.public_url as pi_url, odi.public_url as odi_url
    FROM public.offers o
    LEFT JOIN public.product_images pi ON pi.product_id = o.product_id AND pi.role = 'primary' AND pi.approval_status = 'approved'
    LEFT JOIN public.offer_display_images odi ON odi.offer_id = o.id AND odi.approval_status = 'approved'
    WHERE o.source_offer_id IN (
      'doc_982ef82677fe1d5d:p001:ip001_001:s01',
      'doc_982ef82677fe1d5d:p001:ip001_009:s01',
      'doc_982ef82677fe1d5d:p001:ip001_010:s01',
      'doc_982ef82677fe1d5d:p001:ip001_014:s01',
      'doc_982ef82677fe1d5d:p001:ip001_015:s01'
    )
    ORDER BY o.source_offer_id;
  `);
  console.log(JSON.stringify(res.rows, null, 2));
  await client.query('ROLLBACK');
  await client.end();
}
run().catch(console.error);
