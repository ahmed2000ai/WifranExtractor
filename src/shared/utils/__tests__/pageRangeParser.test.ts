import { describe, it, expect } from 'vitest';
import { parsePageSelection, formatPageList, formatPageRanges } from '../pageRangeParser';

describe('pageRangeParser', () => {
  const totalPages = 24;

  describe('Valid inputs', () => {
    it('accepts a single page range: 1-5', () => {
      const res = parsePageSelection('1-5', totalPages);
      expect(res.ok).toBe(true);
      expect(res.pages).toEqual([1, 2, 3, 4, 5]);
      expect(res.selectedCount).toBe(5);
      expect(res.normalizedString).toBe('1, 2, 3, 4, 5');
      expect(res.formattedRanges).toBe('1-5');
    });

    it('accepts comma-separated pages: 1,2,3', () => {
      const res = parsePageSelection('1,2,3', totalPages);
      expect(res.ok).toBe(true);
      expect(res.pages).toEqual([1, 2, 3]);
      expect(res.selectedCount).toBe(3);
      expect(res.normalizedString).toBe('1, 2, 3');
      expect(res.formattedRanges).toBe('1-3');
    });

    it('accepts mixed ranges and individual pages: 1-3,7,10-12', () => {
      const res = parsePageSelection('1-3,7,10-12', totalPages);
      expect(res.ok).toBe(true);
      expect(res.pages).toEqual([1, 2, 3, 7, 10, 11, 12]);
      expect(res.selectedCount).toBe(7);
      expect(res.normalizedString).toBe('1, 2, 3, 7, 10, 11, 12');
      expect(res.formattedRanges).toBe('1-3, 7, 10-12');
    });

    it('accepts non-contiguous selections: 2,4-6,9', () => {
      const res = parsePageSelection('2,4-6,9', totalPages);
      expect(res.ok).toBe(true);
      expect(res.pages).toEqual([2, 4, 5, 6, 9]);
      expect(res.selectedCount).toBe(5);
      expect(res.normalizedString).toBe('2, 4, 5, 6, 9');
      expect(res.formattedRanges).toBe('2, 4-6, 9');
    });

    it('handles surrounding and internal whitespace cleanly', () => {
      const res = parsePageSelection('  2 ,  4 - 6  , 9  ', totalPages);
      expect(res.ok).toBe(true);
      expect(res.pages).toEqual([2, 4, 5, 6, 9]);
    });

    it('removes duplicates and preserves ascending order: 8, 2-5, 3, 8', () => {
      const res = parsePageSelection('8, 2-5, 3, 8', totalPages);
      expect(res.ok).toBe(true);
      expect(res.pages).toEqual([2, 3, 4, 5, 8]);
      expect(res.selectedCount).toBe(5);
      expect(res.normalizedString).toBe('2, 3, 4, 5, 8');
    });

    it('accepts single page selection', () => {
      const res = parsePageSelection('4', totalPages);
      expect(res.ok).toBe(true);
      expect(res.pages).toEqual([4]);
      expect(res.selectedCount).toBe(1);
      expect(res.normalizedString).toBe('4');
      expect(res.formattedRanges).toBe('4');
    });

    it('accepts range where start === end: 4-4', () => {
      const res = parsePageSelection('4-4', totalPages);
      expect(res.ok).toBe(true);
      expect(res.pages).toEqual([4]);
      expect(res.selectedCount).toBe(1);
    });

    it('accepts full document range: 1-24', () => {
      const res = parsePageSelection('1-24', totalPages);
      expect(res.ok).toBe(true);
      expect(res.selectedCount).toBe(24);
      expect(res.pages[0]).toBe(1);
      expect(res.pages[23]).toBe(24);
    });
  });

  describe('Invalid inputs & Rejections', () => {
    it('rejects empty input', () => {
      const res = parsePageSelection('', totalPages);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/cannot be empty/i);
    });

    it('rejects whitespace-only input', () => {
      const res = parsePageSelection('    ', totalPages);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/cannot be empty/i);
    });

    it('rejects zero as a page number', () => {
      const res = parsePageSelection('0', totalPages);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/1 or greater/i);
    });

    it('rejects zero in range start: 0-5', () => {
      const res = parsePageSelection('0-5', totalPages);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/1 or greater/i);
    });

    it('rejects negative page numbers: -1', () => {
      const res = parsePageSelection('-1', totalPages);
      expect(res.ok).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('rejects reversed page ranges: 5-2', () => {
      const res = parsePageSelection('5-2', totalPages);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/reversed/i);
    });

    it('rejects out-of-bounds single page: 25 when total is 24', () => {
      const res = parsePageSelection('25', totalPages);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/out of bounds/i);
    });

    it('rejects out-of-bounds range end: 20-30 when total is 24', () => {
      const res = parsePageSelection('20-30', totalPages);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/exceeds document total/i);
    });

    it('rejects empty comma tokens (e.g. leading, trailing, or double commas)', () => {
      expect(parsePageSelection('1,,3', totalPages).ok).toBe(false);
      expect(parsePageSelection(',1,3', totalPages).ok).toBe(false);
      expect(parsePageSelection('1,3,', totalPages).ok).toBe(false);
    });

    it('rejects non-numeric tokens: abc, 1-a, 1:4', () => {
      expect(parsePageSelection('abc', totalPages).ok).toBe(false);
      expect(parsePageSelection('1-a', totalPages).ok).toBe(false);
      expect(parsePageSelection('1:4', totalPages).ok).toBe(false);
      expect(parsePageSelection('1..4', totalPages).ok).toBe(false);
      expect(parsePageSelection('1-2-3', totalPages).ok).toBe(false);
    });

    it('rejects invalid document page count <= 0', () => {
      expect(parsePageSelection('1-3', 0).ok).toBe(false);
      expect(parsePageSelection('1-3', -5).ok).toBe(false);
    });
  });

  describe('format helpers', () => {
    it('formatPageList formats arrays properly', () => {
      expect(formatPageList([1, 2, 3, 5, 8])).toBe('1, 2, 3, 5, 8');
    });

    it('formatPageRanges creates compact range notation', () => {
      expect(formatPageRanges([1, 2, 3, 5, 7, 8, 9])).toBe('1-3, 5, 7-9');
      expect(formatPageRanges([4])).toBe('4');
      expect(formatPageRanges([])).toBe('');
    });
  });
});

