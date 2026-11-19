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
  const res = await client.query(`
    SELECT o.id as offer_id, o.source_offer_id, o.title_en, o.title_ar, o.product_id, 
           p.name_en as prod_name_en, p.name_ar as prod_name_ar, p.brand_name as prod_brand,
           p.canonical_product_key,
           o.thumbnail_url, o.image_url, v.image_url as consumer_image_url
    FROM public.offers o
    LEFT JOIN public.products p ON o.product_id = p.id
    LEFT JOIN public.v_consumer_offers v ON v.id = o.id
    WHERE o.source_offer_id LIKE 'doc_982ef82677fe1d5d:%'
    ORDER BY o.source_offer_id;
  `);
  const missing = res.rows.filter(r => !r.consumer_image_url);
  const present = res.rows.filter(r => !!r.consumer_image_url);
  console.log('Total Al Nokhbah offers:', res.rows.length);
  console.log('Present consumer images count:', present.length);
  console.log('Missing consumer images count:', missing.length);
  console.log('\n--- The 11 Missing Offers in Production ---');
  missing.forEach(m => console.log(JSON.stringify(m)));
  await client.end();
}
run().catch(console.error);
