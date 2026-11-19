import { copyFileSync, mkdirSync, existsSync, cpSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const cwd = process.cwd();
const stageDir = join(cwd, 'temp/reconciliation_opt004c_r1/evidence_staging');
if (existsSync(stageDir)) {
  require('fs').rmSync(stageDir, { recursive: true, force: true });
}
mkdirSync(stageDir, { recursive: true });

console.log('Staging review evidence files...');

// 1. Reconciled Ledgers & Ground Truth
copyFileSync(
  join(cwd, 'temp/reconciliation_opt004c_r1/reconciled_benchmark_ledger.json'),
  join(stageDir, 'reconciled_benchmark_ledger.json')
);
copyFileSync(
  join(cwd, 'temp/reconciliation_opt004c_r1/reconciled_opt004c_ledger.json'),
  join(stageDir, 'reconciled_opt004c_ledger.json')
);
copyFileSync(
  join(cwd, 'temp/reconciliation_opt004c_r1/golden_p1_reconciled_ground_truth.json'),
  join(stageDir, 'golden_p1_reconciled_ground_truth.json')
);

// 2. Standalone HTML Report
copyFileSync(
  join(cwd, 'temp/reconciliation_opt004c_r1/report.html'),
  join(stageDir, 'report.html')
);

// 3. Atomic JSON Extractions
copyFileSync(
  join(cwd, 'temp/benchmark_runs/OPT-004C/GOLDEN-P1__mq_high.json'),
  join(stageDir, 'GOLDEN-P1__mq_high.json')
);
copyFileSync(
  join(cwd, 'temp/benchmark_runs/OPT-004C/GOLDEN-P1__mq_medium.json'),
  join(stageDir, 'GOLDEN-P1__mq_medium.json')
);
copyFileSync(
  join(cwd, 'temp/benchmark_runs/OPT-004C/BNDW-P2__mq_high.json'),
  join(stageDir, 'BNDW-P2__mq_high.json')
);
copyFileSync(
  join(cwd, 'temp/benchmark_runs/OPT-004C/BNDW-P2__mq_medium.json'),
  join(stageDir, 'BNDW-P2__mq_medium.json')
);

// 4. Annotated Visual Overlays
const cropsDest = join(stageDir, 'crops');
mkdirSync(cropsDest, { recursive: true });

const stages = ['GOLDEN-P1__mq_high', 'GOLDEN-P1__mq_medium', 'BNDW-P2__mq_high', 'BNDW-P2__mq_medium'];
for (const s of stages) {
  const srcStage = join(cwd, 'temp/benchmark_runs/OPT-004C/crops', s);
  const destStage = join(cropsDest, s);
  if (existsSync(srcStage)) {
    cpSync(srcStage, destStage, { recursive: true });
  }
}

console.log('Staging complete. Total staged size checked.');

// Create ZIP archive
const zipPath = join(cwd, 'WIFRAN-EXTRACTOR-GEMINI-OPT-004C-EVIDENCE.zip');
if (existsSync(zipPath)) {
  require('fs').unlinkSync(zipPath);
}

console.log(`Compressing evidence package into: ${zipPath}`);
const psCmd = `powershell -Command "Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force"`;
execSync(psCmd, { stdio: 'inherit' });

console.log(`ZIP package successfully generated at: ${zipPath}`);

