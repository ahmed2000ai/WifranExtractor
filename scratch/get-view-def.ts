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
    SELECT pg_get_viewdef('public.v_consumer_offers', true) as view_def;
  `);
  console.log('v_consumer_offers view definition:');
  console.log(res.rows[0].view_def);
  await client.end();
}
run().catch(console.error);
