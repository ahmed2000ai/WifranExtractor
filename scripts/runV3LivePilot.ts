/**
 * CLI Entrypoint for WIFRAN-EXTRACTOR-IDENTITY-005E Controlled Live V3 Pilot.
 *
 * Usage:
 *   npx tsx scripts/runV3LivePilot.ts --status
 *   npx tsx scripts/runV3LivePilot.ts --slot pilot_crop_01_baskin_robbins
 *   npx tsx scripts/runV3LivePilot.ts --resume
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  V3_PILOT_HARD_MAX_REQUESTS,
  V3_PILOT_HARD_SPEND_CAP_USD,
  runV3LivePilot,
  type V3PilotManifest
} from '../src/main/ocr/v3LivePilotRunner';

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function main() {
  const statusOnly = process.argv.includes('--status');
  const onlySlotId = getArgValue('--slot');
  const maxSlotsStr = getArgValue('--max-slots');
  const maxSlots = maxSlotsStr ? Number(maxSlotsStr) : undefined;
  const outputDir = join(process.cwd(), 'Extracts', 'pilot_v3_005e');
  const manifestPath = join(outputDir, 'manifest.json');

  if (statusOnly) {
    if (!existsSync(manifestPath)) {
      console.log('No manifest initialized yet at Extracts/pilot_v3_005e/manifest.json.');
      process.exit(0);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as V3PilotManifest;
    console.log(JSON.stringify({
      counters: manifest.counters,
      limits: manifest.limits,
      stoppedReason: manifest.stoppedReason,
      slots: manifest.slots.map((s) => ({
        slotId: s.slotId,
        kind: s.kind,
        status: s.status,
        attemptCount: s.attemptCount,
        durationMs: s.durationMs,
        finishReason: s.finishReason,
        schemaValid: s.schemaValid,
        extractedOfferCount: s.extractedOfferCount,
        estimatedCostUsd: s.estimatedCostUsd,
        errorCode: s.errorCode
      }))
    }, null, 2));
    process.exit(0);
  }

  console.log(
    `[V3-PILOT-005E] Starting isolated pilot run (maxRequests=${V3_PILOT_HARD_MAX_REQUESTS}, hardCap=$${V3_PILOT_HARD_SPEND_CAP_USD}${onlySlotId ? `, onlySlot=${onlySlotId}` : ''})...`
  );

  const result = await runV3LivePilot({
    outputDir,
    onlySlotId,
    maxSlotsToRunThisInvocation: Number.isFinite(maxSlots) ? maxSlots : undefined
  });

  console.log(
    `[V3-PILOT-005E] Run finished. Executed this run: ${result.executedThisRun.join(', ') || '(none)'}`
  );
  console.log(
    `[V3-PILOT-005E] Counters: ${JSON.stringify(result.manifest.counters)} | stoppedReason=${result.manifest.stoppedReason}`
  );
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error('[V3-PILOT-005E] FATAL:', err?.message || err);
    process.exitCode = 1;
  });
