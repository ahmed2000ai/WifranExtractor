import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Requirement 14: Main-Process Bundle Mistral Rate Limit Queue Verification', () => {
  const bundlePath = path.join(process.cwd(), 'out', 'main', 'index.js');

  it('proves that the built bundle does not contain unresolved runtime require for mistralRateLimitQueue', () => {
    // If the bundle exists (built via npm run build), verify it has no unbundled runtime require
    if (fs.existsSync(bundlePath)) {
      const bundleContent = fs.readFileSync(bundlePath, 'utf8');

      // Must NOT contain external CommonJS require of nonexistent relative module
      expect(bundleContent).not.toMatch(/require\(['"]\.\/mistralRateLimitQueue['"]\)/);
      expect(bundleContent).not.toMatch(/require\(['"]\.\.\/ocr\/mistralRateLimitQueue['"]\)/);

      // Must contain bundled class and functions
      expect(bundleContent).toContain('class MistralRateLimitQueue');
      expect(bundleContent).toContain('sharedMistralRateLimitQueue');
      expect(bundleContent).toContain('mistralRateLimitQueue');
    }
  });

  it('proves that source modules (mistralOcrProvider, itemImageOcrService, cropAndItemOcrWorkflow) statically import mistralRateLimitQueue', () => {
    const providerSource = fs.readFileSync(path.join(process.cwd(), 'src', 'main', 'ocr', 'mistralOcrProvider.ts'), 'utf8');
    const itemOcrSource = fs.readFileSync(path.join(process.cwd(), 'src', 'main', 'ocr', 'itemImageOcrService.ts'), 'utf8');
    const workflowSource = fs.readFileSync(path.join(process.cwd(), 'src', 'main', 'workflow', 'cropAndItemOcrWorkflow.ts'), 'utf8');

    // Verify static ES import is present
    expect(providerSource).toMatch(/import\s+.*runWithMistralRateLimit.*from\s+['"]\.\/mistralRateLimitQueue['"]/);
    expect(itemOcrSource).toMatch(/import\s+.*runWithMistralRateLimit.*from\s+['"]\.\/mistralRateLimitQueue['"]/);
    expect(workflowSource).toMatch(/import\s+.*mistralRateLimitQueue.*from\s+['"]\.\.\/ocr\/mistralRateLimitQueue['"]/);

    // Verify no dynamic require remains in those files
    expect(providerSource).not.toMatch(/require\(['"]\.\/mistralRateLimitQueue['"]\)/);
    expect(itemOcrSource).not.toMatch(/require\(['"]\.\/mistralRateLimitQueue['"]\)/);
    expect(workflowSource).not.toMatch(/require\(['"]\.\.\/ocr\/mistralRateLimitQueue['"]\)/);
  });
});
