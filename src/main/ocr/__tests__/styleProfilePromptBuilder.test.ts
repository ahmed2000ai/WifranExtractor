import { describe, it, expect } from 'vitest';
import { buildStyleProfilePrompt } from '../styleProfilePromptBuilder';

describe('styleProfilePromptBuilder', () => {
  it('includes strict JSON instruction', () => {
    const prompt = buildStyleProfilePrompt({ scope: 'page', pageNumber: 1 });
    expect(prompt).toContain('Return strict valid JSON only.');
  });

  it('explicitly says do not extract final item data', () => {
    const prompt = buildStyleProfilePrompt({ scope: 'page', pageNumber: 1 });
    expect(prompt).toContain('Do not extract final item data.');
  });

  it('mentions offer price and original price style', () => {
    const prompt = buildStyleProfilePrompt({ scope: 'page', pageNumber: 1 });
    expect(prompt).toContain('current offer prices');
    expect(prompt).toContain('old/original/crossed-out prices');
    expect(prompt).toContain('crossed-out text');
  });

  it('mentions size/content style', () => {
    const prompt = buildStyleProfilePrompt({ scope: 'page', pageNumber: 1 });
    expect(prompt).toContain('product sizes/content values');
  });

  it('mentions color and price block color', () => {
    const prompt = buildStyleProfilePrompt({ scope: 'page', pageNumber: 1 });
    expect(prompt).toContain('text color');
    expect(prompt).toContain('price block color');
  });

  it('explicitly says sizes and attributes are not prices', () => {
    const prompt = buildStyleProfilePrompt({ scope: 'page', pageNumber: 1 });
    expect(prompt).toContain('1.5L, 730ml, 10kg, 8x135g, and 30PCS are size/content/quantity indicators, not prices.');
    expect(prompt).toContain('50 inch, 55 inch, 65 inch, 4K, HD, LED are product attributes, not prices.');
  });
});
