import { describe, it, expect } from 'vitest';
import { listAvailableExtractions } from '../extractionPackageService';

describe('listAvailableExtractions', () => {
  it('lists available extraction folders in Extracts directory', async () => {
    const results = await listAvailableExtractions();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const pandaExtract = results.find(r => r.folderName === 'Panda_Test');
    expect(pandaExtract).toBeDefined();
    if (pandaExtract) {
      expect(pandaExtract.folderPath).toContain('Panda_Test');
      expect(pandaExtract.canPreview).toBe(true);
      expect(pandaExtract.hasPrePublishSummary).toBe(true);
      expect(pandaExtract.itemCount).toBeGreaterThan(0);
    }

    const bndwExtract = results.find(r => r.folderName === 'BNDW_Test');
    expect(bndwExtract).toBeDefined();
    if (bndwExtract) {
      expect(bndwExtract.canPreview).toBe(true);
      expect(bndwExtract.itemCount).toBeGreaterThan(0);
    }
  });
});
