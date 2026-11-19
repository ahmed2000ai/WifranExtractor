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
    WHERE id IN (19, 20, 21, 36)
    ORDER BY id;
  `);
  console.log('Products 19, 20, 21, 36:');
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}
run().catch(console.error);
