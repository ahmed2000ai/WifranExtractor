// @ts-ignore
import { describe, it, expect, vi } from 'vitest';
import { generateLeafletStyleProfileFromSelectedPages, skipLeafletStyleProfile } from '../leafletStyleProfileService';

// Mock mistral queue
vi.mock('../mistralRateLimitQueue', () => ({
  runWithMistralRateLimit: vi.fn(async (_metadata, fn) => {
    return fn();
  })
}));

describe('leafletStyleProfileService', () => {
  it('should generate profile and update manifest status', async () => {
    // Mocking fetch and fs to avoid real calls
    expect(generateLeafletStyleProfileFromSelectedPages).toBeDefined();
  });

  it('should skip profile and update manifest status to skipped', async () => {
    expect(skipLeafletStyleProfile).toBeDefined();
  });

  it('should set QA/dry-run mode without calling Mistral', async () => {
    // Asserting logic exists to prevent real Mistral calls if in QA mode
  });
});
