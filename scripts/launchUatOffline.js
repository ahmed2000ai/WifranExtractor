#!/usr/bin/env node
/**
 * WIFRAN-EXTRACTOR-METADATA-UAT-002
 * Offline UAT Electron Application Launcher.
 *
 * Hard Isolation:
 * - Sets WIFRAN_OFFLINE_UAT=1
 * - Blocks live Gemini and Mistral API network calls
 * - Blocks remote Supabase database operations and storage uploads
 * - Uses isolated UAT metadata cache (temp/uat_metadata_cache/)
 * - Uses isolated UAT vision ledger (temp/uat_metadata_cache/uat_vision_ledger.json)
 * - Uses isolated UAT workspaces (workspaces_uat/)
 */

process.env.WIFRAN_OFFLINE_UAT = '1';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function resolveElectronViteCli() {
  try {
    const pkgPath = require.resolve('electron-vite/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && pkg.bin['electron-vite'];
    if (binRel) {
      const candidate = path.resolve(path.dirname(pkgPath), binRel);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    // Fall through to npx fallback
  }
  return null;
}

console.log('================================================================');
console.log('  STARTING WIFRAN OFFERS EXTRACTOR — OFFLINE UAT MODE');
console.log('  Environment: WIFRAN_OFFLINE_UAT=1');
console.log('  Live AI Network Calls: STRICTLY BLOCKED');
console.log('  Remote Supabase Mutations: STRICTLY BLOCKED');
console.log('  Ledger Isolation: temp/uat_metadata_cache/uat_vision_ledger.json');
console.log('================================================================');

const extraArgs = process.argv.slice(2);
const env = {
  ...process.env,
  WIFRAN_OFFLINE_UAT: '1'
};
// VS Code / Electron-based IDE terminals often set ELECTRON_RUN_AS_NODE=1,
// which forces the child Electron binary into plain Node mode where `electron.app` is undefined.
delete env.ELECTRON_RUN_AS_NODE;

const electronViteCli = resolveElectronViteCli();
const child = electronViteCli
  ? spawn(process.execPath, [electronViteCli, 'dev', ...extraArgs], {
      stdio: 'inherit',
      env
    })
  : process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', 'npx', 'electron-vite', 'dev', ...extraArgs], {
        stdio: 'inherit',
        env
      })
    : spawn('npx', ['electron-vite', 'dev', ...extraArgs], {
        stdio: 'inherit',
        env
      });

child.on('error', (err) => {
  console.error('Failed to launch Electron Vite in Offline UAT mode:', err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 0);
});

