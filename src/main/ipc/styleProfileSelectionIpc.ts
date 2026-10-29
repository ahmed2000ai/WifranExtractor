import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { generateLeafletStyleProfileFromSelectedPages, skipLeafletStyleProfile } from '../ocr/leafletStyleProfileService';
import { loadExtractionManifest } from '../extraction/extractionManifestService';
import { error as logError } from '../logging/logger';

export function registerStyleProfileSelectionIpcHandlers() {
  ipcMain.handle('styleProfileSelection:listRenderedPages', async (_, packagePath: string) => {
    try {
      const manifest = await loadExtractionManifest(packagePath);
      if (!manifest) {
        throw new Error('Manifest not found');
      }

      const pagesDir = path.join(packagePath, 'pages');
      if (!fs.existsSync(pagesDir)) {
        return [];
      }

      const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.webp') && f.startsWith('page-'));
      return files.map(f => {
        const pageNumMatch = f.match(/page-(\d+)/);
        const pageNum = pageNumMatch ? parseInt(pageNumMatch[1], 10) : 0;
        return {
          pageNumber: pageNum,
          path: path.join(pagesDir, f)
        };
      }).sort((a, b) => a.pageNumber - b.pageNumber);
    } catch (e: any) {
      logError(`listRenderedPages failed: ${e.message}`);
      throw e;
    }
  });

  ipcMain.handle('styleProfileSelection:generateLeafletProfile', async (_, input: any) => {
    try {
      const { leafletId, selectedPageNumbers, pageImagePaths, extractionPackagePath } = input;
      return await generateLeafletStyleProfileFromSelectedPages({
        leafletId,
        selectedPageNumbers,
        pageImagePaths,
        extractionPackagePath
      });
    } catch (e: any) {
      logError(`generateLeafletProfile failed: ${e.message}`);
      throw e;
    }
  });

  ipcMain.handle('styleProfileSelection:skip', async (_, packagePath: string) => {
    try {
      await skipLeafletStyleProfile(packagePath);
      return { ok: true };
    } catch (e: any) {
      logError(`skipLeafletStyleProfile failed: ${e.message}`);
      throw e;
    }
  });

  ipcMain.handle('styleProfileSelection:getStatus', async (_, packagePath: string) => {
    try {
      const manifest = await loadExtractionManifest(packagePath);
      return manifest?.style_profile_selection || null;
    } catch (e: any) {
      logError(`getStatus failed: ${e.message}`);
      throw e;
    }
  });
}
