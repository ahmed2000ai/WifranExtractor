/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PreviousExtractionsView } from '../PreviousExtractionsView';
import type { AvailableExtractionItem } from '../../../../../shared/types/extractionManifest';

describe('PreviousExtractionsView', () => {
  const mockExtracts: AvailableExtractionItem[] = [
    {
      folderName: 'Panda_Test',
      folderPath: 'F:/Work/AI Projects/wifran-offers-extractor/Extracts/Panda_Test',
      supermarketId: 'sm-1',
      supermarketName: 'Panda',
      supermarketCode: 'PAND',
      locationLabel: 'National Coverage',
      offerDates: {
        valid_from: '2026-10-13',
        valid_to: '2026-10-19'
      },
      extractionStatus: 'completed',
      dbUpdateStatus: 'not_started',
      pageCount: 3,
      cropCount: 35,
      itemCount: 35,
      createdAt: '2026-10-13T10:00:00.000Z',
      updatedAt: '2026-10-13T12:00:00.000Z',
      hasPrePublishSummary: true,
      hasCanonicalJson: true,
      canPreview: true
    },
    {
      folderName: 'OTHM-JEDC-150726',
      folderPath: 'F:/Work/AI Projects/wifran-offers-extractor/Extracts/OTHM-JEDC-150726',
      supermarketId: 'sm-2',
      supermarketName: 'Othaim Markets',
      supermarketCode: 'OTHM',
      locationLabel: 'Jeddah',
      offerDates: {
        valid_from: '2026-07-15',
        valid_to: '2026-07-21'
      },
      extractionStatus: 'in_progress',
      dbUpdateStatus: 'not_started',
      pageCount: 40,
      cropCount: 0,
      itemCount: 0,
      createdAt: '2026-07-15T10:00:00.000Z',
      updatedAt: '2026-07-15T10:00:00.000Z',
      hasPrePublishSummary: false,
      hasCanonicalJson: false,
      canPreview: false
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).wifranExtractor = {
      extractionPackage: {
        listAvailable: vi.fn().mockResolvedValue({ ok: true, extracts: mockExtracts })
      }
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('renders extraction items returned from Extracts folder', async () => {
    render(
      <PreviousExtractionsView
        onBack={vi.fn()}
        onSelectForPreview={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Panda_Test')).toBeInTheDocument();
      expect(screen.getByText('OTHM-JEDC-150726')).toBeInTheDocument();
    });

    expect(screen.getAllByText(/Panda/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Othaim Markets/)).toBeInTheDocument();
  });

  it('calls onSelectForPreview when Pre-Publish Preview button is clicked', async () => {
    const onSelectForPreviewMock = vi.fn();
    render(
      <PreviousExtractionsView
        onBack={vi.fn()}
        onSelectForPreview={onSelectForPreviewMock}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Panda_Test')).toBeInTheDocument();
    });

    const previewBtn = screen.getAllByRole('button', { name: /pre-publish preview/i })[0];
    fireEvent.click(previewBtn);

    expect(onSelectForPreviewMock).toHaveBeenCalledWith('F:/Work/AI Projects/wifran-offers-extractor/Extracts/Panda_Test');
  });

  it('calls onBack when Back to Import button is clicked', async () => {
    const onBackMock = vi.fn();
    render(
      <PreviousExtractionsView
        onBack={onBackMock}
        onSelectForPreview={vi.fn()}
      />
    );

    const backBtn = screen.getByRole('button', { name: /back to import/i });
    fireEvent.click(backBtn);

    expect(onBackMock).toHaveBeenCalled();
  });

  it('filters items by search input', async () => {
    render(
      <PreviousExtractionsView
        onBack={vi.fn()}
        onSelectForPreview={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Panda_Test')).toBeInTheDocument();
      expect(screen.getByText('OTHM-JEDC-150726')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search by folder name/i);
    fireEvent.change(searchInput, { target: { value: 'Panda' } });

    expect(screen.getByText('Panda_Test')).toBeInTheDocument();
    expect(screen.queryByText('OTHM-JEDC-150726')).not.toBeInTheDocument();
  });
});
