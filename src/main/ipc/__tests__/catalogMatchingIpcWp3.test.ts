import { describe, it, expect, vi, beforeEach } from 'vitest'

const registeredHandlers = new Map<string, (...args: any[]) => Promise<any>>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => Promise<any>) => {
      registeredHandlers.set(channel, handler)
    }
  },
  BrowserWindow: {
    fromWebContents: () => null
  }
}))

import { registerCatalogMatchingIpcHandlers, sharedCatalogMatchingOrchestrator } from '../catalogMatchingIpc'
import { sharedBatchOrchestrationService } from '../../batch/batchOrchestrationService'

describe('Catalog Matching IPC WP3 Fail-Closed Gates', () => {
  beforeEach(() => {
    registeredHandlers.clear()
    registerCatalogMatchingIpcHandlers()
  })

  it('registers pause, cancel, getRetryFailedSummary, retryFailedOnly and rejects unconfirmed matching:start', async () => {
    expect(registeredHandlers.has('matching:estimate')).toBe(true)
    expect(registeredHandlers.has('matching:start')).toBe(true)
    expect(registeredHandlers.has('matching:pause')).toBe(true)
    expect(registeredHandlers.has('matching:cancel')).toBe(true)
    expect(registeredHandlers.has('matching:getRetryFailedSummary')).toBe(true)
    expect(registeredHandlers.has('matching:retryFailedOnly')).toBe(true)

    const startHandler = registeredHandlers.get('matching:start')!
    await expect(startHandler({ sender: {} }, 'batch_unconfirmed')).rejects.toThrow(
      /MATCHING_PREFLIGHT_CONFIRMATION_REQUIRED/
    )
    await expect(
      startHandler({ sender: {} }, { batchId: 'batch_unconfirmed', approvedByOperator: true, approvedMaxBudgetUsd: 0 })
    ).rejects.toThrow(/MATCHING_PREFLIGHT_CONFIRMATION_REQUIRED/)

    const retryHandler = registeredHandlers.get('matching:retryFailedOnly')!
    vi.spyOn(sharedBatchOrchestrationService, 'getUnifiedBatchOffers').mockResolvedValueOnce([] as any)
    await expect(
      retryHandler({ sender: {} }, { batchId: 'missing_batch', approvedByOperator: false, approvedMaxBudgetUsd: 0.05 })
    ).rejects.toThrow(/RETRY_AUTHORIZATION_REQUIRED/)

    const pauseHandler = registeredHandlers.get('matching:pause')!
    const pauseRes = await pauseHandler({ sender: {} }, 'non_active_batch')
    expect(pauseRes.accepted).toBe(false)

    const cancelHandler = registeredHandlers.get('matching:cancel')!
    const cancelRes = await cancelHandler({ sender: {} }, 'non_active_batch')
    expect(cancelRes.accepted).toBe(false)

    // Sanity check orchestrator helper exposure
    expect(typeof sharedCatalogMatchingOrchestrator.getRetryFailedPreflightSummary).toBe('function')
  })
})
