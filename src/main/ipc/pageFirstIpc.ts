import { ipcMain, BrowserWindow } from 'electron';
import { sharedPageFirstPipelineService } from '../page-first/pageFirstPipelineService';
import { loadExtractionManifest } from '../extraction/extractionManifestService';
import type { PageFirstProgressEvent } from '../page-first/pageFirstPipelineService';

export function registerPageFirstIpcHandlers(): void {
  ipcMain.handle('pageFirst:processPage', async (event, input: {
    packageDir: string;
    pdfBaseName: string;
    pageNumber: number;
    trustedContext: any;
    overrideModel?: string;
    maxOffers?: number;
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const onProgress = (p: PageFirstProgressEvent) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('pageFirst:progress', p);
      }
    };
    const onLog = (log: any) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('pageFirst:log', log);
      }
    };

    try {
      return await sharedPageFirstPipelineService.runPipeline({
        packageDir: input.packageDir,
        pdfBaseName: input.pdfBaseName,
        pages: [input.pageNumber],
        trustedContext: input.trustedContext,
        rolloutMode: 'pilot',
        overrideModel: input.overrideModel,
        maxOffers: input.maxOffers,
        onProgress,
        onLog
      });
    } catch (err: any) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('pageFirst:log', {
          code: 'MISTRAL_OCR_REQUEST_FAILED',
          message: `IPC handler failed: ${err.message}`,
          level: 'error',
          timestamp: new Date().toISOString()
        });
      }
      throw err;
    }
  });

  ipcMain.handle('pageFirst:quickTestPage', async (event, input: {
    packageDir: string;
    pdfBaseName: string;
    pageNumber: number;
    trustedContext: any;
    maxOffers?: number;
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const onProgress = (p: PageFirstProgressEvent) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('pageFirst:progress', p);
        win.webContents.send('pageFirst:quickTestProgress', p);
      }
    };
    const onLog = (log: any) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('pageFirst:log', log);
        win.webContents.send('pageFirst:quickTestLog', log);
      }
    };

    try {
      const result = await sharedPageFirstPipelineService.runPipeline({
        packageDir: input.packageDir,
        pdfBaseName: input.pdfBaseName,
        pages: [input.pageNumber],
        trustedContext: input.trustedContext,
        rolloutMode: 'pilot',
        maxOffers: input.maxOffers ?? 2,
        onProgress,
        onLog
      });
      return result;
    } catch (err: any) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('pageFirst:quickTestLog', {
          code: 'QUICK_TEST_FAILED',
          message: `Quick test failed: ${err.message}`,
          level: 'error',
          timestamp: new Date().toISOString()
        });
      }
      throw err;
    }
  });

  ipcMain.handle('pageFirst:processLeaflet', async (event, input: {
    packageDir: string;
    pdfBaseName: string;
    pages?: number[];
    trustedContext: any;
    overrideModel?: string;
    rolloutMode?: 'pilot' | 'primary';
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const onProgress = (p: PageFirstProgressEvent) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('pageFirst:progress', p);
      }
    };
    const onLog = (log: any) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('pageFirst:log', log);
      }
    };

    try {
      return await sharedPageFirstPipelineService.runPipeline({
        packageDir: input.packageDir,
        pdfBaseName: input.pdfBaseName,
        pages: input.pages,
        trustedContext: input.trustedContext,
        rolloutMode: input.rolloutMode || 'pilot',
        overrideModel: input.overrideModel,
        onProgress,
        onLog
      });
    } catch (err: any) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('pageFirst:log', {
          code: 'MISTRAL_OCR_REQUEST_FAILED',
          message: `IPC handler failed: ${err.message}`,
          level: 'error',
          timestamp: new Date().toISOString()
        });
      }
      throw err;
    }
  });

  ipcMain.handle('pageFirst:resume', async (event, input: {
    packageDir: string;
    pdfBaseName: string;
    trustedContext: any;
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const onProgress = (p: PageFirstProgressEvent) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('pageFirst:progress', p);
      }
    };
    const onLog = (log: any) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('pageFirst:log', log);
      }
    };

    try {
      return await sharedPageFirstPipelineService.runPipeline({
        packageDir: input.packageDir,
        pdfBaseName: input.pdfBaseName,
        trustedContext: input.trustedContext,
        rolloutMode: 'pilot',
        onProgress,
        onLog
      });
    } catch (err: any) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('pageFirst:log', {
          code: 'MISTRAL_OCR_REQUEST_FAILED',
          message: `IPC handler failed: ${err.message}`,
          level: 'error',
          timestamp: new Date().toISOString()
        });
      }
      throw err;
    }
  });

  ipcMain.handle('pageFirst:rebuildCropsFromOcr', async (_event, input: {
    packageDir: string;
    pdfBaseName: string;
    trustedContext: any;
    pages?: number[];
  }) => {
    return sharedPageFirstPipelineService.rebuildCropsFromExistingOcr(
      input.packageDir,
      input.pdfBaseName,
      input.trustedContext,
      input.pages
    );
  });

  ipcMain.handle('pageFirst:getStatus', async (_event, packageDir: string) => {
    const manifest = await loadExtractionManifest(packageDir);
    return {
      manifest,
      pageFirstSection: manifest?.page_first_ocr || null
    };
  });
}
