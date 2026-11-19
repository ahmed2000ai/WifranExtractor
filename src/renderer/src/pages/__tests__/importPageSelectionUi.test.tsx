/**
 * @vitest-environment jsdom
 */
/**
 * WIFRAN-EXTRACTOR-IMPORT-PAGES-001 — UNIFIED BATCH MODE
 * Renderer Hook & UI Integration Test Suite (Offline, jsdom).
 *
 * Covers:
 * - useImportForm hook page selection state, validation, PDF switching reset, and restorePageSelection
 * - ImportPage UI: renders Batch Leaflets exclusively, without legacy Single Leaflet toggles or modes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup, renderHook, act } from '@testing-library/react';
import { ImportPage } from '../ImportPage';
import { useImportForm } from '../../hooks/useImportForm';

const DANUBE_ID = 'c2cc16c2-0004-4444-b000-c00000000004';
const PANDA_ID = 'c2cc16c2-0001-4444-b000-c00000000001';
const REGION_CENTRAL_ID = 'b144b6c8-1111-4444-b000-000000000001';

function createMockWifranExtractor() {
  return {
    config: {
      getStatus: vi.fn().mockResolvedValue({
        mistral: {
          apiKey: { configured: true },
          ocrModel: { configured: true },
          ocrEndpoint: { configured: true }
        },
        supabase: {
          url: { configured: true },
          serviceRoleKey: { configured: true },
          storageBucket: { configured: true }
        },
        ocr: { chunkSize: 1 },
        pdf: { renderDpi: 150 },
        importBehavior: {
          autoCreateBrands: false,
          autoCreateProducts: false,
          autoCreateCategories: false,
          skipDuplicateOffers: true,
          defaultOfferStatus: 'published',
          importDefaultStatus: 'published',
          allowNeedsReviewFallback: true,
          publishWarningsAllowed: true,
          dataQualityNeedsReviewThreshold: 80,
          requireImageForDraft: false
        }
      })
    },
    reference: {
      loadAll: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          supermarkets: [
            { id: DANUBE_ID, name_en: 'Danube', name_ar: 'الدانوب', slug: 'danube', code: 'DANB' },
            { id: PANDA_ID, name_en: 'Panda', name_ar: 'بنده', slug: 'panda', code: 'PAND' }
          ],
          cities: [],
          regions: [
            { id: REGION_CENTRAL_ID, name_en: 'Central Region', name_ar: 'المنطقة الوسطى', slug: 'central' }
          ],
          categories: [],
          brands: [],
          units: []
        }
      })
    },
    batch: {
      list: vi.fn().mockResolvedValue([
        {
          batchId: 'batch-2026-11-16T08-39-30-dacbb8',
          createdAt: '2026-11-16T08:39:30.000Z',
          status: 'completed',
          totals: {
            totalPdfs: 1,
            completedPdfs: 1,
            totalOffers: 33
          }
        }
      ]),
      create: vi.fn(),
      start: vi.fn()
    },
    health: {
      check: vi.fn().mockResolvedValue({
        ok: true,
        environment: 'test',
        isOfflineUat: true,
        databaseEnvironment: { context: 'PRODUCTION_UI' }
      })
    }
  };
}

describe('WIFRAN-EXTRACTOR-IMPORT-PAGES-001: Unified Batch Leaflet UI', () => {
  let mockApi: ReturnType<typeof createMockWifranExtractor>;

  beforeEach(() => {
    mockApi = createMockWifranExtractor();
    (window as any).wifranExtractor = mockApi;
  });

  afterEach(() => {
    cleanup();
    delete (window as any).wifranExtractor;
    vi.restoreAllMocks();
  });

  describe('useImportForm hook page selection & reset guarantees', () => {
    it('initializes in all mode with empty selection before PDF is chosen', () => {
      const { result } = renderHook(() => useImportForm());
      expect(result.current.formState.pageSelection.mode).toBe('all');
      expect(result.current.formState.pageSelection.isValid).toBe(true);
      expect(result.current.formState.pageSelection.selectedPages).toEqual([]);
    });

    it('switches to specific mode with empty input and marks invalid', () => {
      const { result } = renderHook(() => useImportForm());
      act(() => {
        result.current.setPageSelectionMode('specific');
      });
      expect(result.current.formState.pageSelection.mode).toBe('specific');
      expect(result.current.formState.pageSelection.isValid).toBe(false);
      expect(result.current.formState.pageSelection.errorMessage).toContain('Page selection cannot be empty');
    });

    it('parses valid specific input into sorted deduplicated array and normalized range string', () => {
      const { result } = renderHook(() => useImportForm());
      act(() => {
        result.current.setPdfFile({
          path: '/path/to/test.pdf',
          name: 'test.pdf',
          sizeBytes: 1024,
          extension: '.pdf',
          pageCount: 10
        });
      });
      act(() => {
        result.current.setSpecificPageSelection('1-3, 5, 2, 8-10');
      });
      expect(result.current.formState.pageSelection.isValid).toBe(true);
      expect(result.current.formState.pageSelection.selectedPages).toEqual([1, 2, 3, 5, 8, 9, 10]);
      expect(result.current.formState.pageSelection.normalizedString).toBe('1, 2, 3, 5, 8, 9, 10');
    });

    it('resets page selection to all mode when selecting a new PDF file', () => {
      const { result } = renderHook(() => useImportForm());
      act(() => {
        result.current.setPdfFile({
          path: '/path/to/test.pdf',
          name: 'test.pdf',
          sizeBytes: 1024,
          extension: '.pdf',
          pageCount: 10
        });
      });
      act(() => {
        result.current.setSpecificPageSelection('1-3');
      });
      expect(result.current.formState.pageSelection.mode).toBe('specific');

      act(() => {
        result.current.setPdfFile({
          path: '/path/to/another.pdf',
          name: 'another.pdf',
          sizeBytes: 1024,
          extension: '.pdf',
          pageCount: 5
        });
      });

      expect(result.current.formState.pageSelection.mode).toBe('all');
      expect(result.current.formState.pageSelection.specificInput).toBe('');
    });
  });

  describe('ImportPage exclusively renders Batch Leaflets without Single Leaflet mode', () => {
    it('displays Batch Leaflets title and description with zero Single Leaflet toggles', async () => {
      render(<ImportPage />);

      // Verify Header
      expect(await screen.findByRole('heading', { name: /batch leaflets/i })).toBeInTheDocument();
      expect(
        screen.getByText(/select multiple supermarket pdf leaflets, extract all offers via gemini flex paygo/i)
      ).toBeInTheDocument();

      // Verify Single Leaflet mode and buttons are completely absent
      expect(screen.queryByText(/single leaflet/i)).not.toBeInTheDocument();
      expect(screen.queryByTestId('mode-single-leaflet')).not.toBeInTheDocument();
      expect(screen.queryByTestId('mode-batch-leaflets')).not.toBeInTheDocument();

      // Verify MultiPdfSelector is rendered
      expect(screen.getByText(/no pdfs selected for batch extraction/i)).toBeInTheDocument();
    });

    it('displays recent batch extractions table when available', async () => {
      render(<ImportPage />);

      await waitFor(() => {
        expect(screen.getByText(/Recent Batch Extractions/i)).toBeInTheDocument();
        expect(screen.getByText('batch-2026-11-16T08-39-30-dacbb8')).toBeInTheDocument();
      });
    });
  });
});
