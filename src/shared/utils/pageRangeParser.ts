/**
 * WIFRAN-EXTRACTOR-IMPORT-PAGES-001
 * Deterministic, reusable page range parser and validator for PDF leaflet page selection.
 */

export interface PageSelectionParseResult {
  ok: boolean;
  pages: number[];
  normalizedString: string;
  formattedRanges: string;
  selectedCount: number;
  error?: string;
}

/**
 * Formats a sorted list of page numbers into a comma-separated string, e.g. "2, 3, 4, 5, 8".
 */
export function formatPageList(pages: number[]): string {
  return pages.join(', ');
}

/**
 * Formats a sorted list of page numbers into compact range notation, e.g. "2-5, 8".
 */
export function formatPageRanges(pages: number[]): string {
  if (pages.length === 0) return '';
  const ranges: string[] = [];
  let rangeStart = pages[0];
  let prev = pages[0];

  for (let i = 1; i < pages.length; i++) {
    const current = pages[i];
    if (current === prev + 1) {
      prev = current;
    } else {
      ranges.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);
      rangeStart = current;
      prev = current;
    }
  }
  ranges.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);
  return ranges.join(', ');
}

/**
 * Parses and strictly validates a user-provided page range string against a document page count.
 *
 * Rules:
 * - Page numbers are 1-based.
 * - Ranges are inclusive.
 * - Commas separate selections.
 * - Whitespace is permitted.
 * - Duplicates are removed.
 * - Pages are sorted in ascending order.
 * - Zero, negative, reversed, malformed, and out-of-bounds entries are rejected.
 * - Empty input is rejected.
 * - Do not silently ignore invalid entries.
 */
export function parsePageSelection(rawInput: string, totalPages: number): PageSelectionParseResult {
  if (typeof totalPages !== 'number' || isNaN(totalPages) || totalPages <= 0) {
    return {
      ok: false,
      pages: [],
      normalizedString: '',
      formattedRanges: '',
      selectedCount: 0,
      error: `Invalid document page count (${totalPages}). Must be at least 1.`
    };
  }

  if (!rawInput || rawInput.trim().length === 0) {
    return {
      ok: false,
      pages: [],
      normalizedString: '',
      formattedRanges: '',
      selectedCount: 0,
      error: 'Page selection cannot be empty. Specify page numbers (e.g. 1-5, 8).'
    };
  }

  const trimmed = rawInput.trim();
  // Split on commas
  const tokens = trimmed.split(',');
  const collected = new Set<number>();

  for (let i = 0; i < tokens.length; i++) {
    const rawToken = tokens[i];
    const token = rawToken.trim();

    if (token.length === 0) {
      return {
        ok: false,
        pages: [],
        normalizedString: '',
        formattedRanges: '',
        selectedCount: 0,
        error: `Empty page token encountered (check for leading, trailing, or double commas in "${trimmed}").`
      };
    }

    if (token.includes('-')) {
      // Range token
      // Check for negative numbers or multiple hyphens
      const hyphenCount = (token.match(/-/g) || []).length;
      if (hyphenCount !== 1) {
        return {
          ok: false,
          pages: [],
          normalizedString: '',
          formattedRanges: '',
          selectedCount: 0,
          error: `Malformed page range "${token}". Must be format "start-end".`
        };
      }

      const parts = token.split('-');
      const startStr = parts[0].trim();
      const endStr = parts[1].trim();

      if (!/^\d+$/.test(startStr) || !/^\d+$/.test(endStr)) {
        return {
          ok: false,
          pages: [],
          normalizedString: '',
          formattedRanges: '',
          selectedCount: 0,
          error: `Malformed page range "${token}". Page numbers must be positive integers.`
        };
      }

      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      if (start <= 0 || end <= 0) {
        return {
          ok: false,
          pages: [],
          normalizedString: '',
          formattedRanges: '',
          selectedCount: 0,
          error: `Page numbers must be 1 or greater in range "${token}".`
        };
      }

      if (start > end) {
        return {
          ok: false,
          pages: [],
          normalizedString: '',
          formattedRanges: '',
          selectedCount: 0,
          error: `Reversed page range "${token}" (${start} to ${end}) is not allowed.`
        };
      }

      if (end > totalPages) {
        return {
          ok: false,
          pages: [],
          normalizedString: '',
          formattedRanges: '',
          selectedCount: 0,
          error: `Page range "${token}" exceeds document total (${totalPages} pages).`
        };
      }

      for (let p = start; p <= end; p++) {
        collected.add(p);
      }
    } else {
      // Single page token
      if (!/^\d+$/.test(token)) {
        return {
          ok: false,
          pages: [],
          normalizedString: '',
          formattedRanges: '',
          selectedCount: 0,
          error: `Invalid page number "${token}". Must be a positive integer.`
        };
      }

      const pageNum = parseInt(token, 10);
      if (pageNum <= 0) {
        return {
          ok: false,
          pages: [],
          normalizedString: '',
          formattedRanges: '',
          selectedCount: 0,
          error: `Page numbers must be 1 or greater (got ${pageNum}).`
        };
      }

      if (pageNum > totalPages) {
        return {
          ok: false,
          pages: [],
          normalizedString: '',
          formattedRanges: '',
          selectedCount: 0,
          error: `Page ${pageNum} is out of bounds (document has ${totalPages} pages).`
        };
      }

      collected.add(pageNum);
    }
  }

  const sortedPages = Array.from(collected).sort((a, b) => a - b);
  const normalizedString = formatPageList(sortedPages);
  const formattedRanges = formatPageRanges(sortedPages);

  return {
    ok: true,
    pages: sortedPages,
    normalizedString,
    formattedRanges,
    selectedCount: sortedPages.length
  };
}

/**
 * Strict variant for batch per-PDF page selection:
 * reuses `parsePageSelection` syntax & bounds rules, and additionally rejects
 * explicit duplicate pages or overlapping range tokens (e.g. "2,2" or "2-4,3").
 */
export function parseStrictBatchPageSelection(
  rawInput: string,
  totalPages: number
): PageSelectionParseResult {
  const base = parsePageSelection(rawInput, totalPages);
  if (!base.ok) return base;

  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const rawToken of rawInput.trim().split(',')) {
    const token = rawToken.trim();
    if (!token) continue;
    if (token.includes('-')) {
      const [startStr, endStr] = token.split('-').map((p) => p.trim());
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      for (let p = start; p <= end; p++) {
        if (seen.has(p)) duplicates.add(p);
        seen.add(p);
      }
    } else {
      const pageNum = parseInt(token, 10);
      if (seen.has(pageNum)) duplicates.add(pageNum);
      seen.add(pageNum);
    }
  }

  if (duplicates.size > 0) {
    const dupList = Array.from(duplicates).sort((a, b) => a - b).join(', ');
    return {
      ok: false,
      pages: [],
      normalizedString: '',
      formattedRanges: '',
      selectedCount: 0,
      error: `Duplicate page number(s) (${dupList}) are not allowed.`
    };
  }

  return base;
}

