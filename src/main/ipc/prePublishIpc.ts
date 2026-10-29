import { ipcMain } from 'electron';
import { buildPrePublishSummary, markPrePublishOpened, markPrePublishApproved } from '../prepublish/prePublishApprovalService';
import { loadExtractionManifest, saveExtractionManifest } from '../extraction/extractionManifestService';

export function registerPrePublishIpc() {
  ipcMain.handle('prePublishPreview:load', async (_, workspacePath: string) => {
    try {
      const summary = await buildPrePublishSummary(workspacePath);
      return { ok: true, summary };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('prePublishPreview:markOpened', async (_, workspacePath: string) => {
    try {
      await markPrePublishOpened(workspacePath);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('prePublishPreview:publishApproved', async (_, workspacePath: string, summaryCounts: any) => {
    try {
      await markPrePublishApproved(workspacePath, summaryCounts);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('prePublishPreview:getStatus', async (_, workspacePath: string) => {
    try {
      const manifest = await loadExtractionManifest(workspacePath);
      return { 
        ok: true, 
        status: manifest?.pre_publish_preview?.status || 'not_opened',
        db_update_status: manifest?.db_update_status || 'not_started'
      };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('prePublishPreview:setDbStatus', async (_, workspacePath: string, status: 'completed' | 'failed') => {
    try {
      const manifest = await loadExtractionManifest(workspacePath);
      if (manifest) {
        manifest.db_update_status = status;
        await saveExtractionManifest(workspacePath, manifest);
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('prePublishPreview:checkRehearsalGates', async (_, workspacePath: string, typedConfirmation?: string) => {
    try {
      const { checkRealPublishRehearsalGates } = require('../prepublish/realPublishRehearsalService');
      const result = await checkRealPublishRehearsalGates(workspacePath, typedConfirmation);
      return { ok: true, result };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('prePublishPreview:getRehearsalConfig', async () => {
    try {
      const { loadEnvConfig } = require('../config/env');
      const config = loadEnvConfig();
      return { ok: true, rehearsalMode: config.rehearsal.publishRehearsalMode, maxRows: config.rehearsal.publishRehearsalMaxRows };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });
}
