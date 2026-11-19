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
    SELECT id, name_en, name_ar, brand_name, canonical_product_key,
           each_size_value, each_size_unit, inner_pack_count, sale_unit_type
    FROM public.products
    WHERE id IN (24, 28, 29)
    ORDER BY id;
  `);
  console.log('Products 24, 28, 29:');
  console.log(JSON.stringify(res.rows, null, 2));

  // Also query the 3 offers
  const offRes = await client.query(`
    SELECT id, source_offer_id, title_en, title_ar, offer_price, product_id,
           each_size_value, each_size_unit, inner_pack_count, sale_unit_type
    FROM public.offers
    WHERE source_offer_id IN (
      'doc_982ef82677fe1d5d:p001:ip001_010:s01',
      'doc_982ef82677fe1d5d:p001:ip001_014:s01',
      'doc_982ef82677fe1d5d:p001:ip001_015:s01'
    )
    ORDER BY source_offer_id;
  `);
  console.log('\nOffers p001_010, p001_014, p001_015:');
  console.log(JSON.stringify(offRes.rows, null, 2));

  await client.end();
}
run().catch(console.error);
