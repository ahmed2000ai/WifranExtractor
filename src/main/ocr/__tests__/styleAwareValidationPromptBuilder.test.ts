import { describe, it, expect } from 'vitest';
import { buildStyleAwareValidationPrompt } from '../styleAwareValidationPromptBuilder';

describe('styleAwareValidationPromptBuilder', () => {
  it('includes raw extraction JSON and canonical draft', () => {
    const prompt = buildStyleAwareValidationPrompt({
      sourceItemNumber: '001',
      rawExtractionJson: { mockRaw: 'test' },
      canonicalDraft: { mockCanonical: 'test' }
    });
    expect(prompt).toContain('"mockRaw": "test"');
    expect(prompt).toContain('"mockCanonical": "test"');
  });

  it('includes style profile when provided', () => {
    const prompt = buildStyleAwareValidationPrompt({
      sourceItemNumber: '001',
      rawExtractionJson: {},
      canonicalDraft: {},
      styleProfile: { offer_price_patterns: [{ test: 'yes' }] }
    });
    expect(prompt).toContain('"test": "yes"');
  });

  it('handles null style profile safely', () => {
    const prompt = buildStyleAwareValidationPrompt({
      sourceItemNumber: '001',
      rawExtractionJson: {},
      canonicalDraft: {},
      styleProfile: null
    });
    expect(prompt).toContain('No page-level style profile is available');
  });

  it('says crop evidence beats style profile', () => {
    const prompt = buildStyleAwareValidationPrompt({
      sourceItemNumber: '001',
      rawExtractionJson: {},
      canonicalDraft: {}
    });
    expect(prompt).toContain('1. Crop-specific visual evidence');
  });

  it('warns against 1.5L/730ml being prices', () => {
    const prompt = buildStyleAwareValidationPrompt({
      sourceItemNumber: '001',
      rawExtractionJson: {},
      canonicalDraft: {}
    });
    expect(prompt).toContain('1.5L is size/content, not an offer price.');
    expect(prompt).toContain('730ml is size/content, not an offer price.');
  });
});
