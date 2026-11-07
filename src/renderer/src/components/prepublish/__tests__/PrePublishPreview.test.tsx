/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PrePublishPreview } from '../PrePublishPreview';
import { PipelineProvider } from '../../../context/PipelineContext';

vi.mock('../../../context/PipelineContext', () => ({
  usePipelineContext: () => ({
    importForm: { formState: {}, configStatus: { supabase: { url: { configured: true }, serviceRoleKey: { configured: true } } } }
  }),
  PipelineProvider: ({ children }: any) => <div>{children}</div>
}));

describe('PrePublishPreview Manual Publish Flow', () => {
  afterEach(() => {
    cleanup();
  });

  const mockSummary = {
    supermarket_name: 'Panda',
    location_label: 'Riyadh Main',
    leaflet_id: 'leaflet-panda-2026',
    offer_start_date: '2026-10-01',
    offer_end_date: '2026-10-15',
    counts: {
      total_items: 10,
      publish: 8,
      publish_but_exclude_from_comparison: 1,
      skip_or_quarantine: 1,
      warnings: 0,
      blocking_errors: 0,
      non_grocery: 0,
      display_unit_price_visible: 9,
      display_unit_price_hidden: 1,
      display_unit_price_below_threshold: 0,
      display_unit_price_calculation_error: 0
    },
    runtime_accuracy_gate: {
      decision: 'pass',
      critical_failure_count: 0,
      suspicious_row_count: 0,
      fixture_candidate_count: 0,
      page_style_profile_failure_count: 0
    },
    items: [
      {
        source_page_number: 1,
        source_item_number: '001',
        crop_path: '/crops/001.jpg',
        publish_decision: 'publish',
        preview_eligible: true,
        display_in_preview: true,
        confidence: 'high',
        comparison_eligible: true,
        comparison_exclusion_reason: null,
        fields: [],
        blocking_errors: [],
        non_blocking_warnings: []
      }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    (window as any).wifranExtractor = {
      prePublishPreview: {
        load: vi.fn().mockReturnValue(new Promise(() => {})),
        markOpened: vi.fn(),
        publishApproved: vi.fn()
      }
    };

    render(
      <PipelineProvider>
        <PrePublishPreview workspacePath="/test" onClose={vi.fn()} onPublishStarted={vi.fn()} />
      </PipelineProvider>
    );

    expect(screen.getByText('Loading preview...')).toBeInTheDocument();
  });

  it('renders clearly labeled "Publish to Database" button and requires confirmation before any publish', async () => {
    const markOpenedMock = vi.fn().mockResolvedValue({ ok: true });
    const publishApprovedMock = vi.fn().mockResolvedValue({ ok: true });
    const onPublishStartedMock = vi.fn();

    (window as any).wifranExtractor = {
      prePublishPreview: {
        load: vi.fn().mockResolvedValue({ ok: true, summary: mockSummary }),
        markOpened: markOpenedMock,
        publishApproved: publishApprovedMock
      }
    };

    render(
      <PipelineProvider>
        <PrePublishPreview workspacePath="/test" onClose={vi.fn()} onPublishStarted={onPublishStartedMock} />
      </PipelineProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Pre-Publish Preview')).toBeInTheDocument();
    });

    // Verify opening preview does NOT call publishApproved or onPublishStarted
    expect(publishApprovedMock).not.toHaveBeenCalled();
    expect(onPublishStartedMock).not.toHaveBeenCalled();

    // Verify "Publish to Database" button is present and enabled
    const publishBtn = screen.getByText('Publish to Database');
    expect(publishBtn).toBeInTheDocument();
    expect(publishBtn).not.toBeDisabled();

    // Click "Publish to Database"
    fireEvent.click(publishBtn);

    // Confirmation modal must appear with supermarket, location, leaflet, and offer count
    expect(screen.getByText('Confirm Publish to Database')).toBeInTheDocument();
    expect(screen.getByText('Panda')).toBeInTheDocument();
    expect(screen.getByText('Riyadh Main')).toBeInTheDocument();
    expect(screen.getByText(/leaflet-panda-2026/)).toBeInTheDocument();
    expect(screen.getByText('9 offers')).toBeInTheDocument();

    // Crucial: before confirming, still NO publish calls
    expect(publishApprovedMock).not.toHaveBeenCalled();
    expect(onPublishStartedMock).not.toHaveBeenCalled();

    // Click "Cancel" -> modal closes, ZERO DB writes/calls
    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);

    expect(screen.queryByText('Confirm Publish to Database')).not.toBeInTheDocument();
    expect(publishApprovedMock).not.toHaveBeenCalled();
    expect(onPublishStartedMock).not.toHaveBeenCalled();

    // Open confirm dialog again and click "Approve & Publish"
    fireEvent.click(publishBtn);
    const approveBtn = screen.getByText('Approve & Publish');
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(publishApprovedMock).toHaveBeenCalledWith('/test', mockSummary.counts);
      expect(onPublishStartedMock).toHaveBeenCalled();
    });
  });

  it('disables Publish button when blocking accuracy gate fails', async () => {
    const blockedSummary = {
      ...mockSummary,
      runtime_accuracy_gate: {
        decision: 'block_publish',
        critical_failure_count: 2,
        suspicious_row_count: 1,
        fixture_candidate_count: 0,
        page_style_profile_failure_count: 0
      }
    };

    (window as any).wifranExtractor = {
      prePublishPreview: {
        load: vi.fn().mockResolvedValue({ ok: true, summary: blockedSummary }),
        markOpened: vi.fn(),
        publishApproved: vi.fn()
      }
    };

    render(
      <PipelineProvider>
        <PrePublishPreview workspacePath="/test" onClose={vi.fn()} onPublishStarted={vi.fn()} />
      </PipelineProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Pre-Publish Preview')).toBeInTheDocument();
    });

    const publishBtn = screen.getByText('Publish to Database');
    expect(publishBtn).toBeDisabled();
  });

  it('keeps item details table hidden by default and reveals only non-empty fields with humanized labels on Show Details', async () => {
    const itemWithVariousFields = {
      ...mockSummary,
      items: [
        {
          source_page_number: 4,
          source_item_number: '005',
          crop_path: '/crops/005.jpg',
          publish_decision: 'publish',
          preview_eligible: true,
          display_in_preview: true,
          confidence: 'high',
          comparison_eligible: true,
          comparison_exclusion_reason: null,
          fields: [
            { field_name: 'source_page_number', value: 4 },
            { field_name: 'source_item_number', value: '005' },
            { field_name: 'title_ar', value: 'مايونيز نور' },
            { field_name: 'title_en', value: 'Noor Mayonnaise' },
            { field_name: 'brand_text', value: 'Noor' },
            { field_name: 'offer_price', value: 9.99 },
            { field_name: 'pack_quantity', value: 2 },
            { field_name: 'bundle_quantity', value: null },
            { field_name: 'total_content_value', value: null },
            { field_name: 'condition_text', value: '—' },
            { field_name: 'display_unit_price_hidden_reason', value: 'missing_total_content' }
          ],
          blocking_errors: [],
          non_blocking_warnings: []
        }
      ]
    };

    (window as any).wifranExtractor = {
      prePublishPreview: {
        load: vi.fn().mockResolvedValue({ ok: true, summary: itemWithVariousFields }),
        markOpened: vi.fn(),
        publishApproved: vi.fn()
      }
    };

    render(
      <PipelineProvider>
        <PrePublishPreview workspacePath="/test" onClose={vi.fn()} onPublishStarted={vi.fn()} />
      </PipelineProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Pre-Publish Preview')).toBeInTheDocument();
    });

    // 1. By default, the details table should NOT be visible
    expect(screen.queryByText('Page Number')).not.toBeInTheDocument();
    expect(screen.queryByText('Pack Quantity')).not.toBeInTheDocument();

    // 2. The toggle button is visible with 'Show Details'
    const toggleBtn = screen.getByRole('button', { name: /Show Details/i });
    expect(toggleBtn).toBeInTheDocument();

    // 3. Click 'Show Details'
    fireEvent.click(toggleBtn);

    // 4. Button now says 'Hide Details'
    expect(screen.getByRole('button', { name: /Hide Details/i })).toBeInTheDocument();

    // 5. Table is now visible with humanized labels for populated fields
    expect(screen.getByText('Page Number')).toBeInTheDocument();
    expect(screen.getByText('Title (Arabic)')).toBeInTheDocument();
    expect(screen.getAllByText('مايونيز نور').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Title (English)')).toBeInTheDocument();
    expect(screen.getAllByText('Noor Mayonnaise').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Pack Quantity')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    // 6. Null and empty fields MUST NOT be displayed
    expect(screen.queryByText('Bundle Quantity')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Content Value')).not.toBeInTheDocument();
    expect(screen.queryByText('Condition')).not.toBeInTheDocument();

    // 7. Missing reason fields and values MUST NOT be displayed
    expect(screen.queryByText(/missing_total_content/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Display unit price hidden/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Raw Attributes/i)).not.toBeInTheDocument();

    // 8. Click 'Hide Details' -> Table collapses again
    fireEvent.click(screen.getByRole('button', { name: /Hide Details/i }));
    expect(screen.queryByText('Page Number')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show Details/i })).toBeInTheDocument();
  });

  it('disables publish button and shows banner when extraction was already published, and enables force republish with checkbox', async () => {
    const publishApprovedMock = vi.fn().mockResolvedValue({ ok: true });
    (window as any).wifranExtractor = {
      prePublishPreview: {
        load: vi.fn().mockResolvedValue({ 
          ok: true, 
          summary: { 
            ...mockSummary, 
            db_update_status: 'completed',
            published_at: '2026-10-30T04:00:00.000Z'
          } 
        }),
        markOpened: vi.fn().mockResolvedValue({ ok: true }),
        publishApproved: publishApprovedMock,
        getStatus: vi.fn().mockResolvedValue({ ok: true, db_update_status: 'completed', published_at: '2026-10-30T04:00:00.000Z' })
      }
    };

    render(
      <PipelineProvider>
        <PrePublishPreview workspacePath="/test" onClose={vi.fn()} onPublishStarted={vi.fn()} />
      </PipelineProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Pre-Publish Preview')).toBeInTheDocument();
    });

    // Verify already published banner & badge are displayed
    expect(screen.getByText('ALREADY PUBLISHED')).toBeInTheDocument();
    expect(screen.getByText(/This extraction was previously published to the database/i)).toBeInTheDocument();

    // Verify publish button is disabled and indicates already published
    const publishBtn = screen.getByRole('button', { name: /Already Published to DB/i });
    expect(publishBtn).toBeInTheDocument();
    expect(publishBtn).toBeDisabled();

    // Check Enable Force Re-publish checkbox
    const forceCheckbox = screen.getByLabelText(/Enable Force Re-publish/i);
    expect(forceCheckbox).toBeInTheDocument();
    expect(forceCheckbox).not.toBeChecked();

    fireEvent.click(forceCheckbox);
    expect(forceCheckbox).toBeChecked();

    // Button should now be enabled and say 'Force Re-publish to DB'
    const forcePublishBtn = screen.getByRole('button', { name: /Force Re-publish to DB/i });
    expect(forcePublishBtn).toBeInTheDocument();
    expect(forcePublishBtn).not.toBeDisabled();

    // Click Force Re-publish -> opens confirm modal with republish warning
    fireEvent.click(forcePublishBtn);
    expect(screen.getByText(/Confirm Force Re-publish to Database/i)).toBeInTheDocument();
    expect(screen.getByText(/Republish Notice:/i)).toBeInTheDocument();

    // Confirm publish
    const confirmBtn = screen.getByRole('button', { name: /Approve & Publish/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(publishApprovedMock).toHaveBeenCalledWith('/test', mockSummary.counts, { forceRePublish: true });
    });
  });
});

