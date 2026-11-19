import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const cwd = process.cwd();
const outDir = join(cwd, 'temp/reconciliation_opt004c_r1');
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

interface ReconciledLedgerEntry {
  reconciledGlobalAttempt: number;
  originalLedgerAttempt: number;
  sourceLedger: 'benchmark_ledger.json' | 'OPT-004C/request_ledger.json';
  milestone: 'OPT-001' | 'OPT-002' | 'OPT-003' | 'OPT-004C';
  timestamp?: string;
  pageId: string;
  configType: string;
  backend: 'vertex' | 'developer';
  requestedTier: string;
  actualTrafficType?: string;
  model: string;
  status: 'success' | 'rejected' | 'failed_429';
  isGenuineProviderCall: boolean;
  costClassification: 'measured_usage' | 'historical_placeholder' | 'zero_charge_rejected';
  promptTokens?: number;
  candidatesTokens?: number;
  thoughtsTokens?: number;
  totalTokens?: number;
  costUsd: number;
  requestDurationMs?: number;
  recordFile?: string | null;
  reconciliationNotes: string;
}

function reconcileLedgers() {
  console.log('Reconciling Benchmark Ledgers...');

  const historicalRaw = JSON.parse(readFileSync(join(cwd, 'temp/benchmark_ledger.json'), 'utf8'));
  const opt004cRaw = JSON.parse(readFileSync(join(cwd, 'temp/benchmark_runs/OPT-004C/request_ledger.json'), 'utf8'));

  const reconciled: ReconciledLedgerEntry[] = [];

  // 1. Process Historical Entries 1 to 67
  historicalRaw.forEach((e: any, idx: number) => {
    const origId = e.attemptNumber || (idx + 1);
    let milestone: ReconciledLedgerEntry['milestone'] = 'OPT-003';
    let costClass: ReconciledLedgerEntry['costClassification'] = 'measured_usage';
    let isGenuine = e.status === 'success';
    let notes = '';

    if (origId <= 13) {
      milestone = 'OPT-001';
      if (e.status === 'rejected') {
        costClass = 'zero_charge_rejected';
        isGenuine = false;
        notes = 'Local/SDK validation failure or rejected request (0 cost)';
      } else if (e.pageId === 'PING' || e.pageId.includes('PROBE')) {
        costClass = 'measured_usage';
        notes = 'Minimal live probe request';
      } else {
        notes = 'Early probe / live canary test';
      }
    } else if (origId >= 14 && origId <= 51) {
      milestone = 'OPT-003';
      costClass = 'historical_placeholder';
      notes = 'Historical Developer API benchmark attempt; granular tokens unpreserved; cost estimated at flat placeholder rate (~$0.04448)';
    } else if (origId >= 52 && origId <= 67) {
      milestone = 'OPT-003';
      costClass = 'measured_usage';
      notes = 'Conditional OPT-003 live benchmark on Vertex AI; verified provider usage metadata & atomic JSON records preserved';
    }

    reconciled.push({
      reconciledGlobalAttempt: origId,
      originalLedgerAttempt: origId,
      sourceLedger: 'benchmark_ledger.json',
      milestone,
      timestamp: e.timestamp,
      pageId: e.pageId,
      configType: e.configType,
      backend: e.backend || 'vertex',
      requestedTier: e.configType.includes('flex') ? 'flex' : 'standard',
      actualTrafficType: e.trafficType,
      model: e.model || 'gemini-3.8-flash',
      status: e.status,
      isGenuineProviderCall: isGenuine,
      costClassification: costClass,
      promptTokens: e.promptTokens,
      candidatesTokens: e.candidatesTokens,
      thoughtsTokens: e.thoughtsTokens,
      totalTokens: e.totalTokens,
      costUsd: e.costUsd || 0,
      recordFile: e.recordFile || null,
      reconciliationNotes: notes
    });
  });

  // 2. Process OPT-004C Entries (Mapped to Global 68 to 73)
  opt004cRaw.forEach((e: any, idx: number) => {
    const reconciledId = 67 + (idx + 1);
    let costClass: ReconciledLedgerEntry['costClassification'] = 'measured_usage';
    let isGenuine = e.status === 'SUCCESS';
    let statusClean: ReconciledLedgerEntry['status'] = e.status === 'SUCCESS' ? 'success' : 'failed_429';
    let notes = '';

    if (e.status !== 'SUCCESS') {
      costClass = 'zero_charge_rejected';
      isGenuine = true; // Sent to Vertex AI, but returned 429 Resource Exhausted
      notes = `Vertex AI HTTP 429 RESOURCE_EXHAUSTED after ${e.requestDurationMs}ms (billed: $0.00)`;
    } else {
      notes = `OPT-004C Master Quality live extraction (${e.thinkingLevel} thinking); granular usage metadata & visual crops preserved`;
    }

    reconciled.push({
      reconciledGlobalAttempt: reconciledId,
      originalLedgerAttempt: e.globalAttemptNumber, // 52..57 in isolated ledger
      sourceLedger: 'OPT-004C/request_ledger.json',
      milestone: 'OPT-004C',
      timestamp: e.timestamp,
      pageId: e.pageId,
      configType: `master_quality_${e.thinkingLevel.toLowerCase()}`,
      backend: 'vertex',
      requestedTier: 'standard',
      actualTrafficType: 'standard',
      model: 'gemini-3.8-flash',
      status: statusClean,
      isGenuineProviderCall: isGenuine,
      costClassification: costClass,
      promptTokens: e.promptTokens,
      candidatesTokens: e.candidatesTokens,
      thoughtsTokens: e.thoughtsTokens,
      totalTokens: e.totalTokens,
      costUsd: e.totalCostUsd || 0,
      requestDurationMs: e.requestDurationMs,
      recordFile: e.artifactPath || null,
      reconciliationNotes: notes
    });
  });

  // 3. Compute Granular Totals
  const totalAttempts = reconciled.length;
  const genuineCalls = reconciled.filter(e => e.isGenuineProviderCall).length;
  const successfulCalls = reconciled.filter(e => e.status === 'success').length;
  const failed429Calls = reconciled.filter(e => e.status === 'failed_429').length;
  const rejectedCalls = reconciled.filter(e => e.status === 'rejected').length;

  let measuredSpend = 0;
  let placeholderSpend = 0;

  reconciled.forEach(e => {
    if (e.costClassification === 'measured_usage') {
      measuredSpend += e.costUsd;
    } else if (e.costClassification === 'historical_placeholder') {
      placeholderSpend += e.costUsd;
    }
  });

  const totalCumulativeSpend = measuredSpend + placeholderSpend;
  const opt004cSpend = reconciled.filter(e => e.milestone === 'OPT-004C').reduce((acc, e) => acc + e.costUsd, 0);

  console.log('--- RECONCILIATION AUDIT SUMMARY ---');
  console.log(`Total Global Attempts: ${totalAttempts} (Attempts 1 to 73)`);
  console.log(`- Genuine Provider Network Attempts: ${genuineCalls}`);
  console.log(`- Successful Provider Responses: ${successfulCalls}`);
  console.log(`- HTTP 429 Rate-Limited Attempts: ${failed429Calls}`);
  console.log(`- Pre-Request Rejected Attempts: ${rejectedCalls}`);
  console.log(`- Verified Measured Spend: $${measuredSpend.toFixed(6)} USD`);
  console.log(`- Historical Placeholder Spend: $${placeholderSpend.toFixed(6)} USD`);
  console.log(`- Total Cumulative Estimated Spending: $${totalCumulativeSpend.toFixed(6)} USD`);
  console.log(`- Milestone OPT-004C Spend (6 attempts): $${opt004cSpend.toFixed(6)} USD`);
  console.log(`- Budget Ceiling: $5.000000 USD (Remaining: $${(5.0 - totalCumulativeSpend).toFixed(6)} USD)`);

  // Write reconciled master ledger
  const masterLedgerPath = join(outDir, 'reconciled_benchmark_ledger.json');
  writeFileSync(masterLedgerPath, JSON.stringify(reconciled, null, 2), 'utf8');

  // Write reconciled OPT-004C sub-ledger with corrected global attempt numbering (68 to 73)
  const opt004cReconciled = reconciled.filter(e => e.milestone === 'OPT-004C').map((e, idx) => ({
    attemptIndex: idx + 1,
    reconciledGlobalAttemptNumber: e.reconciledGlobalAttempt,
    collidingOriginalGlobalAttemptNumber: e.originalLedgerAttempt,
    timestamp: e.timestamp,
    pageId: e.pageId,
    configType: e.configType,
    thinkingLevel: e.configType.includes('high') ? 'HIGH' : 'MEDIUM',
    status: e.status,
    promptTokens: e.promptTokens,
    candidatesTokens: e.candidatesTokens,
    thoughtsTokens: e.thoughtsTokens,
    totalTokens: e.totalTokens,
    costUsd: e.costUsd,
    requestDurationMs: e.requestDurationMs,
    reconciliationNotes: e.reconciliationNotes
  }));

  const opt004cLedgerPath = join(outDir, 'reconciled_opt004c_ledger.json');
  writeFileSync(opt004cLedgerPath, JSON.stringify(opt004cReconciled, null, 2), 'utf8');

  console.log(`Reconciled ledgers saved to:\n  ${masterLedgerPath}\n  ${opt004cLedgerPath}`);
}

reconcileLedgers();

