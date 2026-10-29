/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { PrePublishPreview } from '../PrePublishPreview';


import { usePipelineContext } from '../../../context/PipelineContext';

vi.mock('../../../context/PipelineContext', () => ({
  usePipelineContext: vi.fn(),
  PipelineContext: { Provider: ({ children }: any) => <div>{children}</div> }
}));

const mockSummary = {
  supermarket_name: 'Test',
  location_label: 'Test',
  offer_start_date: '2024-01-01',
  offer_end_date: '2024-01-07',
  counts: {
    total_items: 3,
    publish: 2,
    publish_but_exclude_from_comparison: 1,
    skip_or_quarantine: 0,
    warnings: 0,
    blocking_errors: 0,
    non_grocery: 0
  },
  items: []
};

describe('RealPublishRehearsal in PrePublishPreview', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (window as any).wifranExtractor = {
      prePublishPreview: {
        load: vi.fn().mockResolvedValue({ ok: true, summary: mockSummary }),
        markOpened: vi.fn().mockResolvedValue({ ok: true }),
        getRehearsalConfig: vi.fn().mockResolvedValue({ ok: true, rehearsalMode: true, maxRows: 5 }),
        checkRehearsalGates: vi.fn().mockResolvedValue({ ok: true, result: { ok: true, targetClassification: 'sandbox', eligibleRows: 3 } })
      }
    };

    vi.mocked(usePipelineContext).mockReturnValue({
      importForm: {
        configStatus: {
          supabase: { url: { configured: true }, serviceRoleKey: { configured: true } }
        }
      }
    } as any);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders rehearsal mode header and disables publish if dry run is active', async () => {
    render(<PrePublishPreview workspacePath="/test" isDryRun={true} onClose={() => {}} onPublishStarted={() => {}} />);
    
    // Wait for async load
    await screen.findByText('Real publish rehearsal is blocked because dry-run mode is enabled.');
    
    const btn = screen.getByText('Dry Run Publish');
    expect(btn).toBeDisabled();
  });

  it('enables rehearsal publish if gates pass and typed confirmation matches', async () => {
    render(<PrePublishPreview workspacePath="/test" isDryRun={false} onClose={() => {}} onPublishStarted={() => {}} />);
    
    // Wait for async load
    await screen.findByText('Ready to rehearse 3 rows. Target: sandbox');
    
    const startBtn = screen.getByText('Run Real Publish Rehearsal');
    expect(startBtn).not.toBeDisabled();

    fireEvent.click(startBtn);

    const input = screen.getByPlaceholderText('PUBLISH VERIFIED REHEARSAL');
    const proceedBtn = screen.getByRole('button', { name: /Approve & Publish/i });

    expect(proceedBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'WRONG' } });
    expect(proceedBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'PUBLISH VERIFIED REHEARSAL' } });
    await waitFor(() => {
      expect(proceedBtn).not.toBeDisabled();
    });
  });

  it('shows production target warning', async () => {
    (window as any).wifranExtractor.prePublishPreview.checkRehearsalGates.mockResolvedValue({ 
      ok: true, 
      result: { ok: true, targetClassification: 'production', eligibleRows: 3 } 
    });

    render(<PrePublishPreview workspacePath="/test" isDryRun={false} onClose={() => {}} onPublishStarted={() => {}} />);
    
    await screen.findByText('Ready to rehearse 3 rows. Target: production');
  });

  it('disables publish button if gates fail', async () => {
    (window as any).wifranExtractor.prePublishPreview.checkRehearsalGates.mockResolvedValue({ 
      ok: true, 
      result: { ok: false, blockedReason: 'Publish rehearsal blocked: eligible row count exceeds rehearsal limit.' } 
    });

    render(<PrePublishPreview workspacePath="/test" isDryRun={false} onClose={() => {}} onPublishStarted={() => {}} />);
    
    await screen.findByText(/eligible row count exceeds rehearsal limit/);
    
    const startBtn = screen.getByText('Run Real Publish Rehearsal');
    expect(startBtn).toBeDisabled();
  });
});
