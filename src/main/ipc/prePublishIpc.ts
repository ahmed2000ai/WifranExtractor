import { ipcMain } from 'electron';
import { buildPrePublishSummary, markPrePublishOpened, markPrePublishApproved } from '../prepublish/prePublishApprovalService';
import { loadExtractionManifest, saveExtractionManifest } from '../extraction/extractionManifestService';
import { syncApprovedOffers } from '../db/offerSyncService';
import { checkRealPublishRehearsalGates } from '../prepublish/realPublishRehearsalService';
import { loadEnvConfig } from '../config/env';

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

  ipcMain.handle('prePublishPreview:publishApproved', async (event, workspacePath: string, summaryCounts: any, options?: { forceRePublish?: boolean }) => {
    try {
      const manifest = await loadExtractionManifest(workspacePath);
      if (!manifest) {
        throw new Error(`Manifest not found at: ${workspacePath}`);
      }

      const isAlreadyPublished = manifest.db_update_status === 'completed' || manifest.stages?.db_update === 'completed';
      if (isAlreadyPublished && !options?.forceRePublish) {
        return {
          ok: false,
          error: `Extraction '${manifest.extraction_folder_name || workspacePath}' was already published to the database. Re-publishing is blocked to prevent duplicate operations. Enable Force Re-publish if you intentionally wish to re-sync.`
        };
      }

      await markPrePublishApproved(workspacePath, summaryCounts, options);
      const syncResult = await syncApprovedOffers(workspacePath, (progressEvent: any) => {
        try {
          event.sender.send('offerSync:progress', progressEvent);
        } catch (err) {
          console.error('[PrePublishIpc] Failed to send progress event to sender:', err);
        }
      }, options);
      return { ok: syncResult.ok, result: syncResult };
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
        db_update_status: manifest?.db_update_status || 'not_started',
        published_at: (manifest?.db_update_status === 'completed' || manifest?.stages?.db_update === 'completed')
          ? (manifest?.updated_at || manifest?.pre_publish_preview?.approved_at || null)
          : null,
        folder_name: manifest?.extraction_folder_name || null
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
      const result = await checkRealPublishRehearsalGates(workspacePath, typedConfirmation);
      return { ok: true, result };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('prePublishPreview:getRehearsalConfig', async () => {
    try {
      const config = loadEnvConfig();
      return { ok: true, rehearsalMode: config.rehearsal.publishRehearsalMode, maxRows: config.rehearsal.publishRehearsalMaxRows };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });
}
