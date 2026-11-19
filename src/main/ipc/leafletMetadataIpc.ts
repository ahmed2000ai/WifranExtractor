/**
 * WIFRAN-EXTRACTOR-METADATA-002
 * Electron IPC Handler for Leaflet Metadata Discovery, Confirmation & Boundary Validation.
 */

import { ipcMain } from 'electron';
import { LeafletMetadataService } from '../metadata/leafletMetadataService';
import { info as logInfo, error as logError } from '../logging/logger';

let metadataServiceInstance: LeafletMetadataService | null = null;

export function getMetadataService(): LeafletMetadataService {
  if (!metadataServiceInstance) {
    metadataServiceInstance = new LeafletMetadataService();
  }
  return metadataServiceInstance;
}

export function registerLeafletMetadataIpc(): void {
  const service = getMetadataService();

  // 1. Discover metadata
  ipcMain.handle('metadata:discover', async (_event, input: any) => {
    try {
      logInfo(`[LeafletMetadataIpc] Discovering metadata for ${input.leafletFingerprint}`);
      const record = await service.discoverMetadata(input);
      return { ok: true, data: record };
    } catch (err: any) {
      logError(`[LeafletMetadataIpc] Discovery error: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  // 2. Discover metadata from package
  ipcMain.handle('metadata:discoverFromPackage', async (_event, packageDir: string, options?: any) => {
    try {
      logInfo(`[LeafletMetadataIpc] Discovering metadata from package: ${packageDir}`);
      const record = await service.discoverMetadataFromPackage(packageDir, options);
      return { ok: true, data: record };
    } catch (err: any) {
      logError(`[LeafletMetadataIpc] Package discovery error: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  // 3. Get cached metadata
  ipcMain.handle('metadata:get', async (_event, fingerprint: string) => {
    try {
      const record = service.getCache().get(fingerprint);
      return { ok: true, data: record };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // 4. Confirm metadata by operator
  ipcMain.handle('metadata:confirm', async (_event, input: any) => {
    try {
      logInfo(`[LeafletMetadataIpc] Operator confirmed metadata for ${input.leafletFingerprint}`);
      const record = service.confirmMetadata(input);
      return { ok: true, data: record };
    } catch (err: any) {
      logError(`[LeafletMetadataIpc] Confirmation error: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  // 5. Invalidate cached metadata
  ipcMain.handle('metadata:invalidate', async (_event, fingerprint: string) => {
    try {
      service.getCache().invalidate(fingerprint);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // 6. Main-process publishing readiness validation gate
  ipcMain.handle('metadata:validatePublishReadiness', async (_event, input: any) => {
    try {
      const validation = service.validatePublishReadiness(input);
      return validation;
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // 7. Grant bounded AI Vision budget extension
  ipcMain.handle('metadata:grantBudgetExtension', async (_event, input: { leafletFingerprint: string; additionalAttempts: number }) => {
    try {
      logInfo(`[LeafletMetadataIpc] Granting budget extension (+${input.additionalAttempts}) for ${input.leafletFingerprint}`);
      const res = service.grantBudgetExtension(input.leafletFingerprint, input.additionalAttempts);
      return res;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 8. Get vision budget status
  ipcMain.handle('metadata:getBudgetStatus', async (_event, fingerprint: string) => {
    try {
      const status = service.getVisionBudgetStatus(fingerprint);
      return { ok: true, data: status };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
}
