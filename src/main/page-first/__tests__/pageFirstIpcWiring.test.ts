import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, Function>();
const sentWebContentsEvents: { channel: string; data: any }[] = [];

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Function) => {
      handlers.set(channel, fn);
    }
  },
  BrowserWindow: {
    fromWebContents: () => ({
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: any) => {
          sentWebContentsEvents.push({ channel, data });
        }
      }
    })
  }
}));

import { registerPageFirstIpcHandlers } from '../../ipc/pageFirstIpc';
import { sharedPageFirstPipelineService } from '../pageFirstPipelineService';

describe('Requirement 21: IPC Wiring to Real Page-First Orchestration Service', () => {
  beforeEach(() => {
    handlers.clear();
    sentWebContentsEvents.length = 0;
    registerPageFirstIpcHandlers();
  });

  it('Registers pageFirst:processPage and routes to sharedPageFirstPipelineService.runPipeline with exact page', async () => {
    const runPipelineSpy = vi.spyOn(sharedPageFirstPipelineService, 'runPipeline').mockResolvedValueOnce({
      ok: true,
      extractionMode: 'page_first_annotated_ocr',
      rolloutMode: 'pilot',
      totalPages: 1,
      completedPages: 1,
      unresolvedPages: 0,
      failedPages: 0,
      offersDetected: 2,
      offersLinked: 2,
      cropsGenerated: 2,
      estimatedCostUsd: 0.005,
      report: {} as any,
      items: []
    });

    const handler = handlers.get('pageFirst:processPage');
    expect(handler).toBeDefined();

    const fakeEvent = { sender: {} } as any;
    const testInput = {
      packageDir: '/path/to/workspace',
      pdfBaseName: 'supermarket_catalog',
      pageNumber: 3,
      trustedContext: { leafletId: 'test_123' },
      overrideModel: 'mistral-ocr-4-1'
    };

    const result = await handler!(fakeEvent, testInput);

    // Proves clicking "Test Current Page" reaches the real page-first orchestration service:
    expect(runPipelineSpy).toHaveBeenCalledTimes(1);
    const callArgs = runPipelineSpy.mock.calls[0][0];

    expect(callArgs.packageDir).toBe('/path/to/workspace');
    expect(callArgs.pdfBaseName).toBe('supermarket_catalog');
    expect(callArgs.pages).toEqual([3]); // Exactly the currently selected page
    expect(callArgs.rolloutMode).toBe('pilot'); // Pilot mode allowed
    expect(callArgs.overrideModel).toBe('mistral-ocr-4-1');
    expect(typeof callArgs.onProgress).toBe('function');
    expect(typeof callArgs.onLog).toBe('function');

    expect(result.ok).toBe(true);
    expect(result.completedPages).toBe(1);

    // Verify progress forwarding to webContents
    callArgs.onProgress!({
      stage: 'ocr_running',
      currentPage: 3,
      totalPages: 1,
      primaryCompletedPages: 0,
      retryCompletedPages: 0,
      completedPages: 0,
      unresolvedPages: 0,
      failedPages: 0,
      offersDetected: 0,
      offersLinked: 0,
      cropsGenerated: 0,
      estimatedCostUsd: 0,
      elapsedMs: 0,
      message: 'Running page-first OCR for page 3...'
    });

    expect(sentWebContentsEvents.some(e =>
      e.channel === 'pageFirst:progress' &&
      e.data.message === 'Running page-first OCR for page 3...'
    )).toBe(true);

    // Verify log forwarding to webContents
    callArgs.onLog!({
      code: 'PAGE_FIRST_TEST_START',
      message: 'Starting page-first OCR pipeline for page 3',
      level: 'info'
    });

    expect(sentWebContentsEvents.some(e =>
      e.channel === 'pageFirst:log' &&
      e.data.code === 'PAGE_FIRST_TEST_START'
    )).toBe(true);
  });

  it('Propagates exceptions and notifies renderer when pageFirst:processPage fails', async () => {
    vi.spyOn(sharedPageFirstPipelineService, 'runPipeline').mockRejectedValueOnce(
      new Error('Mistral API key missing. Please configure MISTRAL_API_KEY in .env.local')
    );

    const handler = handlers.get('pageFirst:processPage');
    expect(handler).toBeDefined();

    const fakeEvent = { sender: {} } as any;
    const testInput = {
      packageDir: '/path/to/workspace',
      pdfBaseName: 'test',
      pageNumber: 1,
      trustedContext: {}
    };

    await expect(handler!(fakeEvent, testInput)).rejects.toThrow(/Mistral API key missing/);

    expect(sentWebContentsEvents.some(e =>
      e.channel === 'pageFirst:log' &&
      e.data.code === 'MISTRAL_OCR_REQUEST_FAILED' &&
      e.data.message.includes('IPC handler failed: Mistral API key missing')
    )).toBe(true);
  });
});
