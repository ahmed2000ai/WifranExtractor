import React from 'react';
import type { BatchExtractionCostSummary } from '../../../../shared/types/costAccounting';

interface ExtractionCostSummaryCardProps {
  costSummary: BatchExtractionCostSummary | null | undefined;
  batchStatus?: string;
  compact?: boolean;
  className?: string;
}

function formatUsd4(val: number): string {
  return `$${val.toFixed(4)} USD`;
}

export const ExtractionCostSummaryCard: React.FC<ExtractionCostSummaryCardProps> = ({
  costSummary,
  batchStatus,
  compact = false,
  className = ''
}) => {
  if (!costSummary) {
    return null;
  }

  const {
    totalMeasuredCostUsd,
    categoryBreakdown,
    failedAndRetriedInformational,
    pagesAttempted,
    pagesCompleted,
    offersExtracted,
    totalApiCalls,
    cacheHitCallsCount,
    failedOrRetriedApiCalls,
    unknownCostRequestsCount,
    hasUnconfirmedCosts,
    totalInputTokens,
    totalOutputTokens,
    totalThinkingTokens,
    totalCachedInputTokens,
    avgCostPerExtractedOfferUsd,
    avgCostPerCompletedPageUsd,
    priorSessionsCostUsd,
    latestSessionCostUsd,
    maxAuthorizedSpendingUsd,
    perLeaflet,
    measurementNote
  } = costSummary;

  const isFailedOrCancelled =
    batchStatus === 'failed' || batchStatus === 'cancelled' || batchStatus === 'completed_with_errors';

  return (
    <section
      aria-label="Extraction Cost Summary"
      className={`rounded-xl border ${
        hasUnconfirmedCosts
          ? 'border-amber-700/80 bg-amber-950/20'
          : isFailedOrCancelled
            ? 'border-rose-800/70 bg-slate-950/90'
            : 'border-cyan-800/70 bg-slate-950/90'
      } p-4 space-y-3.5 text-xs shadow-lg ${className}`}
    >
      {/* Header + Hero Total Cost */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">
            EXTRACTION COST SUMMARY
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {totalApiCalls === 0
              ? 'No paid Gemini API requests recorded ($0.0000).'
              : cacheHitCallsCount === totalApiCalls
                ? `All ${cacheHitCallsCount} lookup(s) served from local cache ($0.0000 API spend).`
                : `Measured across ${totalApiCalls} Gemini request(s) (${pagesCompleted}/${pagesAttempted} pages completed, ${offersExtracted} offers).`}
          </p>
        </div>

        <div className="text-right bg-slate-900/90 border border-cyan-700/60 rounded-lg px-4 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            TOTAL GEMINI API COST{hasUnconfirmedCosts ? ' (MEASURED SUBTOTAL)' : ''}
          </div>
          <div className="text-lg font-extrabold font-mono text-cyan-300">
            TOTAL GEMINI API COST: {formatUsd4(totalMeasuredCostUsd)}
          </div>
        </div>
      </div>

      {/* Unconfirmed Cost Warning */}
      {hasUnconfirmedCosts && (
        <div className="p-2.5 rounded-lg bg-amber-950/60 border border-amber-700/80 text-amber-200 text-[11px]">
          ⚠ <strong>{unknownCostRequestsCount} request(s)</strong> terminated without API-reported token metadata (
          <code className="font-mono">unavailable_unknown</code>). These are NOT treated as $0.0000; check Google Cloud
          Billing for final charges.
        </div>
      )}

      {/* Key Operational Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <div className="bg-slate-900/75 border border-slate-800 rounded-lg px-3 py-2">
          <div className="text-[10px] text-slate-400">Pages Attempted / Completed</div>
          <div className="font-mono font-bold text-slate-100 mt-0.5">
            {pagesAttempted} / {pagesCompleted}
          </div>
        </div>
        <div className="bg-slate-900/75 border border-slate-800 rounded-lg px-3 py-2">
          <div className="text-[10px] text-slate-400">Offers Extracted</div>
          <div className="font-mono font-bold text-amber-300 mt-0.5">{offersExtracted}</div>
        </div>
        <div className="bg-slate-900/75 border border-slate-800 rounded-lg px-3 py-2">
          <div className="text-[10px] text-slate-400">API Calls (Cache / Failed)</div>
          <div className="font-mono font-bold text-slate-100 mt-0.5">
            {totalApiCalls} <span className="text-[10px] text-slate-400">({cacheHitCallsCount} cache · {failedOrRetriedApiCalls} failed)</span>
          </div>
        </div>
        <div className="bg-slate-900/75 border border-slate-800 rounded-lg px-3 py-2">
          <div className="text-[10px] text-slate-400">Avg Cost / Offer &amp; Page</div>
          <div className="font-mono font-bold text-cyan-200 mt-0.5">
            {avgCostPerExtractedOfferUsd != null ? `$${avgCostPerExtractedOfferUsd.toFixed(4)}/offer` : 'N/A (0 offers)'}
            {' · '}
            {avgCostPerCompletedPageUsd != null ? `$${avgCostPerCompletedPageUsd.toFixed(4)}/page` : 'N/A (0 pages)'}
          </div>
        </div>
      </div>

      {/* Token & Session Scope Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 text-[11px] font-mono text-slate-300">
        <div>
          Tokens: In <strong className="text-white">{totalInputTokens.toLocaleString()}</strong> · Out{' '}
          <strong className="text-white">{totalOutputTokens.toLocaleString()}</strong> · Thinking{' '}
          <strong className="text-indigo-300">{totalThinkingTokens.toLocaleString()}</strong>
          {totalCachedInputTokens > 0 && (
            <>
              {' '}
              · Cached <strong className="text-emerald-300">{totalCachedInputTokens.toLocaleString()}</strong>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {priorSessionsCostUsd > 0 && (
            <span>
              Prior: <strong className="text-slate-200">{formatUsd4(priorSessionsCostUsd)}</strong> · Latest:{' '}
              <strong className="text-cyan-300">{formatUsd4(latestSessionCostUsd)}</strong>
            </span>
          )}
          {typeof maxAuthorizedSpendingUsd === 'number' && maxAuthorizedSpendingUsd > 0 && (
            <span>
              Max Authorized Cap: <strong className="text-amber-300">{formatUsd4(maxAuthorizedSpendingUsd)}</strong>
            </span>
          )}
        </div>
      </div>

      {/* Mutually Exclusive 5-Category Reconciliation Table */}
      {!compact && (
        <div className="overflow-hidden border border-slate-800 rounded-lg">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-1.5 px-3 font-semibold">Stage Category (Mutually Exclusive)</th>
                <th className="py-1.5 px-3 font-semibold text-right">Measured Cost (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 bg-slate-950/60 text-slate-200">
              <tr>
                <td className="py-1.5 px-3">B1 — Full-page extraction</td>
                <td className="py-1.5 px-3 text-right font-mono">{formatUsd4(categoryBreakdown.b1_full_page)}</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3">B2 — Selective crop analysis</td>
                <td className="py-1.5 px-3 text-right font-mono">{formatUsd4(categoryBreakdown.b2_selective_crop)}</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3">AI catalog matching</td>
                <td className="py-1.5 px-3 text-right font-mono">{formatUsd4(categoryBreakdown.catalog_matching)}</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3">Metadata discovery</td>
                <td className="py-1.5 px-3 text-right font-mono">{formatUsd4(categoryBreakdown.metadata_discovery)}</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3">Other Gemini operations</td>
                <td className="py-1.5 px-3 text-right font-mono">{formatUsd4(categoryBreakdown.other_gemini)}</td>
              </tr>
            </tbody>
            <tfoot className="bg-slate-900/90 border-t border-cyan-800/70 font-bold text-cyan-300">
              <tr>
                <td className="py-2 px-3">TOTAL GEMINI API COST</td>
                <td className="py-2 px-3 text-right font-mono">{formatUsd4(totalMeasuredCostUsd)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Non-additive Failed / Retried Informational Drill-Down */}
      {failedAndRetriedInformational.callsCount > 0 && (
        <div className="px-3 py-2 rounded-lg bg-rose-950/30 border border-rose-800/60 text-[11px] text-rose-200 flex flex-wrap items-center justify-between gap-2">
          <span>
            Informational subset (already included in category totals above — non-additive):{' '}
            <strong>{failedAndRetriedInformational.callsCount}</strong> failed/retried API call(s)
          </span>
          <span className="font-mono font-semibold">
            {formatUsd4(failedAndRetriedInformational.measuredCostUsd)}
            {failedAndRetriedInformational.unknownCostCallsCount > 0
              ? ` (+${failedAndRetriedInformational.unknownCostCallsCount} unconfirmed)`
              : ''}
          </span>
        </div>
      )}

      {/* Per-Leaflet Breakdown */}
      {!compact && perLeaflet.length > 0 && (
        <div className="overflow-hidden border border-slate-800 rounded-lg">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-1.5 px-3 font-semibold">Leaflet</th>
                <th className="py-1.5 px-3 font-semibold text-right">Pages</th>
                <th className="py-1.5 px-3 font-semibold text-right">Offers</th>
                <th className="py-1.5 px-3 font-semibold text-right">Calls (Fail)</th>
                <th className="py-1.5 px-3 font-semibold text-right">Measured Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 bg-slate-950/60 text-slate-300">
              {perLeaflet.map((lf) => (
                <tr key={lf.leafletId}>
                  <td className="py-1.5 px-3 truncate max-w-xs" title={lf.fileName}>
                    {lf.fileName || lf.leafletId}
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono">
                    {lf.pagesCompleted}/{lf.pagesAttempted}
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono">{lf.offersExtracted}</td>
                  <td className="py-1.5 px-3 text-right font-mono">
                    {lf.apiCallsCount} ({lf.failedOrRetriedCallsCount})
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono text-cyan-300">
                    {formatUsd4(lf.measuredCostUsd)}
                    {lf.unknownCostCallsCount > 0 ? ` (+${lf.unknownCostCallsCount} unconfirmed)` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-slate-500">{measurementNote}</p>
    </section>
  );
};
