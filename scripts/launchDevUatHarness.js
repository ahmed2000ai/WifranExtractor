#!/usr/bin/env node
/**
 * WIFRAN-EXTRACTOR-CATALOG-MATCH-001B
 * Development-Only Operator UAT Electron Harness.
 *
 * Isolation guarantees:
 * - Completely strips all production Supabase credentials (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, etc.)
 * - Maps DEV_SUPABASE_* credentials into active variables
 * - Sets WIFRAN_DEV_UAT_HARNESS=1 and WIFRAN_OFFLINE_UAT=1
 * - Connects exclusively to development project ref: gykrbpykjhpyrdrinkuk
 * - Zero access to production database (swratbmclahjyekouned)
 * - Displays visible "⚠️ Database: DEVELOPMENT — TEST ONLY" badge in UI
 * - Live AI calls are mocked ($0 cost)
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Load environment variables from .env.local if present
const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  const content = fs.readFileSync(envLocalPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

// 1. Verify Development credentials are present
const devUrl = process.env.DEV_SUPABASE_URL;
const devKey = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY;
if (!devUrl || !devKey) {
  console.error('ERROR: DEV_SUPABASE_URL or DEV_SUPABASE_SERVICE_ROLE_KEY is missing in .env.local.');
  process.exit(1);
}

// 2. Strip production credentials completely from process environment
const cleanEnv = { ...process.env };
delete cleanEnv.SUPABASE_URL;
delete cleanEnv.SUPABASE_SERVICE_ROLE_KEY;
delete cleanEnv.SUPABASE_ANON_KEY;
delete cleanEnv.SUPABASE_DB_PASSWORD;
delete cleanEnv.NEXT_PUBLIC_SUPABASE_URL;
delete cleanEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 3. Inject Development credentials
cleanEnv.SUPABASE_URL = devUrl;
cleanEnv.SUPABASE_SERVICE_ROLE_KEY = devKey;
cleanEnv.SUPABASE_ANON_KEY = process.env.DEV_SUPABASE_ANON_KEY || '';
cleanEnv.SUPABASE_DB_PASSWORD = process.env.DEV_SUPABASE_DB_PASSWORD || '';
cleanEnv.WIFRAN_DEV_UAT_HARNESS = '1';
cleanEnv.WIFRAN_OFFLINE_UAT = '1'; // Mocked AI responses, zero live API calls
delete cleanEnv.ELECTRON_RUN_AS_NODE;

console.log('================================================================');
console.log('  STARTING WIFRAN EXTRACTOR — DEVELOPMENT UAT HARNESS');
console.log('  Database Target: DEVELOPMENT (gykrbpykjhpyrdrinkuk)');
console.log('  Production Credentials: COMPLETELY STRIPPED FROM MEMORY');
console.log('  AI Spend Mode: OFFLINE SIMULATION ($0.00 spent)');
console.log('  UI Indicator: ⚠️ Database: DEVELOPMENT — TEST ONLY');
console.log('================================================================');

function resolveElectronViteCli() {
  try {
    const pkgPath = require.resolve('electron-vite/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && pkg.bin['electron-vite'];
    if (binRel) {
      const candidate = path.resolve(path.dirname(pkgPath), binRel);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {}
  return null;
}

const extraArgs = process.argv.slice(2);
const electronViteCli = resolveElectronViteCli();
const child = electronViteCli
  ? spawn(process.execPath, [electronViteCli, 'dev', ...extraArgs], { stdio: 'inherit', env: cleanEnv })
  : process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', 'npx', 'electron-vite', 'dev', ...extraArgs], { stdio: 'inherit', env: cleanEnv })
    : spawn('npx', ['electron-vite', 'dev', ...extraArgs], { stdio: 'inherit', env: cleanEnv });

child.on('error', (err) => {
  console.error('Failed to launch Development UAT Harness:', err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});

