import React, { useEffect, useState } from 'react'

type TargetContext = 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'

export const PublicationHistoryRecoveryPanel: React.FC = () => {
  const [dbContext, setDbContext] = useState<TargetContext>('DEVELOPMENT_TEST')
  const [schemaReport, setSchemaReport] = useState<any | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [history, setHistory] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [undoPreview, setUndoPreview] = useState<any | null>(null)
  const [selectedOpDetails, setSelectedOpDetails] = useState<any | null>(null)
  const [undoReason, setUndoReason] = useState('')
  const [authorizeProdUndo, setAuthorizeProdUndo] = useState(false)
  const [showConfirmUndo, setShowConfirmUndo] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState(false)

  const loadAdvancedData = async (ctx: TargetContext) => {
    setActionError(null)
    setSchemaLoading(true)
    setHistoryLoading(true)
    try {
      const [schemaRes, histRes, prevRes] = await Promise.all([
        window.wifranExtractor.config.verifySchemaReadiness(ctx),
        window.wifranExtractor.matching.getPublicationHistory({ context: ctx, limit: 30 }),
        window.wifranExtractor.matching.previewUndoLastPublish({ context: ctx })
      ])
      setSchemaReport(schemaRes)
      setHistory(Array.isArray(histRes) ? histRes : [])
      setUndoPreview(prevRes)
    } catch (err: any) {
      setActionError(err?.message || String(err))
    } finally {
      setSchemaLoading(false)
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    void loadAdvancedData(dbContext)
  }, [dbContext])

  const handleInspectDetails = async (publishOperationId: string) => {
    setActionError(null)
    try {
      const res = await window.wifranExtractor.matching.getPublicationOperationDetails({
        context: dbContext,
        publishOperationId
      })
      setSelectedOpDetails(res)
    } catch (err: any) {
      setActionError(err?.message || String(err))
    }
  }

  const handleExecuteUndo = async () => {
    if (!undoReason.trim()) {
      setActionError('Enter a clear audit reason before rolling back.')
      return
    }
    setBusyAction(true)
    setActionError(null)
    setActionMessage(null)
    try {
      const res = await window.wifranExtractor.matching.undoLastPublish({
        context: dbContext,
        operatorId: 'operator_ui',
        reason: undoReason.trim(),
        publishOperationId: undoPreview?.targetOperation?.publishOperationId,
        operatorAuthorizedProductionPublish: dbContext === 'PRODUCTION_UI' && authorizeProdUndo
      })
      if (res.success) {
        setActionMessage(
          `Undo status: ${res.status}. Reverted ${res.revertedMutationsCount} mutation(s); storage deleted=${res.storageCleanup?.deletedCount ?? 0}, preserved=${res.storageCleanup?.preservedSharedCount ?? 0}, pending=${res.storageCleanup?.failedCount ?? 0}.`
        )
        setShowConfirmUndo(false)
        setUndoReason('')
        await loadAdvancedData(dbContext)
      } else {
        setActionError(
          `Undo blocked (${res.status}): ${(res.blockedReasons || []).join(' | ') || 'Unknown reason'}`
        )
      }
    } catch (err: any) {
      setActionError(err?.message || String(err))
    } finally {
      setBusyAction(false)
    }
  }

  const handleRetryCleanup = async (publishOperationId: string) => {
    setBusyAction(true)
    setActionError(null)
    setActionMessage(null)
    try {
      const res = await window.wifranExtractor.matching.retryUndoStorageCleanup({
        context: dbContext,
        publishOperationId,
        operatorAuthorizedProductionPublish: dbContext === 'PRODUCTION_UI' && authorizeProdUndo
      })
      setActionMessage(
        `Storage cleanup retry (${res.status}): deleted=${res.storageCleanup?.deletedCount ?? 0}, failed=${res.storageCleanup?.failedCount ?? 0}.`
      )
      await loadAdvancedData(dbContext)
    } catch (err: any) {
      setActionError(err?.message || String(err))
    } finally {
      setBusyAction(false)
    }
  }

  return (
    <div className="space-y-4 text-xs text-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div>
          <h3 className="text-sm font-bold text-white">
            Schema Readiness, Publication Journal &amp; Undo Recovery
          </h3>
          <p className="text-[11px] text-slate-400">
            Inspect target database migration parity (009 &amp; 010), immutable publication history, and safely revert the last publish.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="advanced-db-context" className="text-[11px] text-slate-400 font-semibold">
            Target DB:
          </label>
          <select
            id="advanced-db-context"
            aria-label="Target Recovery Database Context"
            value={dbContext}
            onChange={(e) => {
              setDbContext(e.target.value as TargetContext)
              setAuthorizeProdUndo(false)
              setShowConfirmUndo(false)
              setSelectedOpDetails(null)
            }}
            className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
          >
            <option value="DEVELOPMENT_TEST">DEVELOPMENT_TEST</option>
            <option value="PRODUCTION_UI">PRODUCTION_UI</option>
          </select>
          <button
            type="button"
            disabled={schemaLoading || historyLoading}
            onClick={() => void loadAdvancedData(dbContext)}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 font-semibold"
          >
            Refresh
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-700/80 rounded-lg text-emerald-200">
          {actionMessage}
        </div>
      )}
      {actionError && (
        <div className="p-3 bg-rose-950/60 border border-rose-700/80 rounded-lg text-rose-200">
          {actionError}
        </div>
      )}

      {/* Schema Readiness Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <strong className="text-white">Database Schema Parity ({dbContext})</strong>
          {schemaLoading ? (
            <span className="text-slate-400">Checking...</span>
          ) : schemaReport ? (
            <span
              className={`px-2 py-0.5 rounded font-semibold ${
                schemaReport.compatible
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                  : 'bg-rose-950 text-rose-300 border border-rose-700'
              }`}
            >
              {schemaReport.compatible ? 'COMPATIBLE (009 + 010 Verified)' : 'BLOCKED (Missing Schema Parity)'}
            </span>
          ) : null}
        </div>
        {schemaReport && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-300 pt-1">
            <div>Migration 009: {schemaReport.hasMigration009 ? 'Yes' : 'Missing'}</div>
            <div>Migration 010: {schemaReport.hasMigration010 ? 'Yes' : 'Missing'}</div>
            <div>Unique source_offer_id: {schemaReport.hasSourceOfferUniqueIndex ? 'Yes' : 'Missing'}</div>
            <div>v_consumer_offers: {schemaReport.hasConsumerView ? 'Yes' : 'Missing'}</div>
          </div>
        )}
        {schemaReport?.missingDependencies?.length > 0 && (
          <div className="text-[11px] text-rose-300">
            Missing: {schemaReport.missingDependencies.join(', ')}
          </div>
        )}
      </div>

      {/* Guarded Undo Last Publish Panel */}
      <div className="bg-slate-900 border border-amber-800/60 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <strong className="text-amber-200">Undo Last Publish</strong>
            <p className="text-[11px] text-slate-400">
              Reverts only the most recent reversible publish operation after verifying row state hashes and external dependencies.
            </p>
          </div>
          {dbContext === 'PRODUCTION_UI' && (
            <label className="flex items-center gap-1.5 text-[11px] text-rose-300">
              <input
                type="checkbox"
                checked={authorizeProdUndo}
                onChange={(e) => setAuthorizeProdUndo(e.target.checked)}
              />
              <span>Authorize Production Rollback / Cleanup</span>
            </label>
          )}
        </div>

        {undoPreview ? (
          <div className="space-y-2 bg-slate-950/70 border border-slate-800 rounded-lg p-3">
            {undoPreview.targetOperation ? (
              <div className="space-y-1 text-[11px]">
                <div>
                  Target Operation:{' '}
                  <code className="text-indigo-300">{undoPreview.targetOperation.publishOperationId}</code>{' '}
                  (Batch: <strong>{undoPreview.targetOperation.batchId}</strong>, Status:{' '}
                  <strong>{undoPreview.targetOperation.status}</strong>)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-slate-300 pt-1">
                  <span>Offers Delete: {undoPreview.affectedCounts?.offersToDelete ?? 0}</span>
                  <span>Offers Restore: {undoPreview.affectedCounts?.offersToRestore ?? 0}</span>
                  <span>Products Delete: {undoPreview.affectedCounts?.productsToDelete ?? 0}</span>
                  <span>Storage Delete: {undoPreview.affectedCounts?.exclusiveStorageObjectsToDelete ?? 0}</span>
                  <span>Shared Kept: {undoPreview.affectedCounts?.reusedStorageObjectsPreserved ?? 0}</span>
                </div>
              </div>
            ) : (
              <div className="text-slate-400">No reversible publish operation found in {dbContext}.</div>
            )}

            {undoPreview.blockedReasons?.length > 0 && (
              <div className="p-2 bg-rose-950/50 border border-rose-800 rounded text-rose-200 text-[11px]">
                Blocked: {undoPreview.blockedReasons.join(' | ')}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              {!showConfirmUndo ? (
                <button
                  type="button"
                  disabled={
                    !undoPreview.canUndo ||
                    busyAction ||
                    (dbContext === 'PRODUCTION_UI' && !authorizeProdUndo)
                  }
                  onClick={() => setShowConfirmUndo(true)}
                  className="px-3.5 py-1.5 bg-rose-700 hover:bg-rose-600 disabled:opacity-40 text-white font-semibold rounded-lg"
                >
                  Undo Last Publish...
                </button>
              ) : (
                <div className="w-full space-y-2 border-t border-slate-800 pt-2">
                  <label htmlFor="undo-reason-input" className="block text-[11px] text-amber-200 font-semibold">
                    Audit Reason for Undo Last Publish (Required):
                  </label>
                  <input
                    id="undo-reason-input"
                    type="text"
                    placeholder="e.g. Incorrect price tier extracted on page 4"
                    value={undoReason}
                    onChange={(e) => setUndoReason(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white text-xs"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() => setShowConfirmUndo(false)}
                      className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={busyAction || !undoReason.trim()}
                      onClick={() => void handleExecuteUndo()}
                      className="px-3 py-1 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-bold rounded"
                    >
                      {busyAction ? 'Reverting...' : 'Confirm Undo Last Publish'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Publication History Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <strong className="text-white">Publication History ({history.length})</strong>
        {history.length === 0 ? (
          <p className="text-slate-400 italic">No publication journal entries recorded for {dbContext}.</p>
        ) : (
          <div className="overflow-x-auto border border-slate-800 rounded-lg">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2 px-3">Operation ID</th>
                  <th className="py-2 px-3">Batch</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Ins / Upd / Noop / Prod</th>
                  <th className="py-2 px-3">Started</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {history.map((op) => (
                  <tr key={op.publishOperationId} className="hover:bg-slate-950/60">
                    <td className="py-2 px-3 font-mono text-indigo-300">
                      {String(op.publishOperationId).slice(0, 8)}...
                    </td>
                    <td className="py-2 px-3 font-mono">{op.batchId}</td>
                    <td className="py-2 px-3">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-semibold">
                        {op.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono">
                      {op.insertedOffersCount} / {op.updatedOffersCount} / {op.unchangedNoopCount} / {op.createdProductsCount}
                    </td>
                    <td className="py-2 px-3 text-slate-400">{op.startedAt}</td>
                    <td className="py-2 px-3 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => void handleInspectDetails(op.publishOperationId)}
                        className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-200"
                      >
                        Details
                      </button>
                      {op.status === 'undo_cleanup_pending' && (
                        <button
                          type="button"
                          disabled={busyAction || (dbContext === 'PRODUCTION_UI' && !authorizeProdUndo)}
                          onClick={() => void handleRetryCleanup(op.publishOperationId)}
                          className="px-2 py-0.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 rounded text-white font-semibold"
                        >
                          Retry Storage Cleanup
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedOpDetails && (
          <div className="p-3 bg-slate-950 border border-indigo-800/70 rounded-lg space-y-2 text-[11px]">
            <div className="flex items-center justify-between">
              <strong className="text-indigo-200">
                Operation Details: {selectedOpDetails.operation?.publishOperationId}
              </strong>
              <button
                type="button"
                onClick={() => setSelectedOpDetails(null)}
                className="text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>
            <div>
              Mutations: <strong>{selectedOpDetails.mutations?.length || 0}</strong> · Skips:{' '}
              <strong>{selectedOpDetails.skips?.length || 0}</strong> · Storage Ops:{' '}
              <strong>{selectedOpDetails.storageOperations?.length || 0}</strong>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
