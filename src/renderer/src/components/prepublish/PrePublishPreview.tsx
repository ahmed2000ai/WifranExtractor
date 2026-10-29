import { useState, useEffect } from 'react';
import type { PrePublishPreviewSummary, PrePublishPreviewItem } from '../../../../shared/types/prePublishPreview';
import { usePipelineContext } from '../../context/PipelineContext';

interface PrePublishPreviewProps {
  workspacePath: string;
  onClose: () => void;
  isDryRun?: boolean;
  qaMode?: boolean;
  onPublishStarted?: (isDryRun?: boolean) => void;
  backButtonText?: string;
  onBack?: () => void;
}

export function PrePublishPreview({ 
  workspacePath, 
  isDryRun = false, 
  qaMode = false, 
  onClose, 
  onPublishStarted,
  backButtonText,
  onBack
}: PrePublishPreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PrePublishPreviewSummary | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [showConfirm, setShowConfirm] = useState(false);

  // Rehearsal Mode states
  const [rehearsalMode, setRehearsalMode] = useState(false);
  const [rehearsalGates, setRehearsalGates] = useState<any>(null);
  const [typedConfirmation, setTypedConfirmation] = useState('');

  const ctx = usePipelineContext();
  const { configStatus } = ctx.importForm;

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await window.wifranExtractor.prePublishPreview.load(workspacePath);
        if (res.ok && res.summary) {
          setSummary(res.summary);
          await window.wifranExtractor.prePublishPreview.markOpened(workspacePath);
        } else {
          setError(res.error || 'Failed to load preview');
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [workspacePath]);

  useEffect(() => {
    async function loadRehearsal() {
      try {
        const confRes = await window.wifranExtractor.prePublishPreview.getRehearsalConfig();
        if (confRes.ok) {
          setRehearsalMode(confRes.rehearsalMode);
        }
        const gatesRes = await window.wifranExtractor.prePublishPreview.checkRehearsalGates(workspacePath, typedConfirmation);
        if (gatesRes.ok) {
          setRehearsalGates(gatesRes.result);
        } else {
          setRehearsalGates({ ok: false, blockedReason: gatesRes.error });
        }
      } catch (e) {
        // ignore
      }
    }
    if (!loading) {
      loadRehearsal();
    }
  }, [workspacePath, loading, typedConfirmation]);

  const handlePublishClick = () => {
    setShowConfirm(true);
  };

  const handleConfirmPublish = async () => {
    if (!summary) return;
    setPublishing(true);
    try {
      // 1. Mark approved in manifest
      const res = await window.wifranExtractor.prePublishPreview.publishApproved(workspacePath, summary.counts);
      if (!res.ok) throw new Error(res.error || 'Failed to mark approved');

      // Trigger DB Sync via callback
      onPublishStarted?.(isDryRun);
    } catch (e: any) {
      setError(e.message);
      setPublishing(false);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading preview...</div>;
  if (error) return <div style={{ padding: 40, color: 'red' }}>Error: {error}</div>;
  if (!summary) return null;

  const dbConfigReady = !!(configStatus?.supabase.url.configured && configStatus?.supabase.serviceRoleKey.configured);
  const eligibleCount = summary.counts.publish + summary.counts.publish_but_exclude_from_comparison;
  const harnessGate = summary.runtime_accuracy_gate;
  const harnessBlocked = harnessGate?.decision === 'block_publish' || harnessGate?.decision === 'needs_human_review';
  const hasBlockingErrorsOnEligible = summary.items.some(
    i => (i.publish_decision === 'publish' || i.publish_decision === 'publish_but_exclude_from_comparison') &&
         i.blocking_errors && i.blocking_errors.length > 0
  );
  const canPublish = dbConfigReady && eligibleCount > 0 && !publishing && !harnessBlocked && !hasBlockingErrorsOnEligible;

  let filteredItems = summary.items;
  if (filter === 'publish') filteredItems = summary.items.filter(i => i.publish_decision === 'publish');
  if (filter === 'exclude') filteredItems = summary.items.filter(i => i.publish_decision === 'publish_but_exclude_from_comparison');
  if (filter === 'skip') filteredItems = summary.items.filter(i => i.publish_decision === 'skip_or_quarantine');
  if (filter === 'warnings') filteredItems = summary.items.filter(i => i.non_blocking_warnings.length > 0);
  if (filter === 'errors') filteredItems = summary.items.filter(i => i.blocking_errors.length > 0);
  if (filter === 'non-grocery') filteredItems = summary.items.filter(i => i.fields.find(f => f.field_name === 'item_domain')?.value === 'electronics' || i.fields.find(f => f.field_name === 'item_domain')?.value === 'appliance' || i.fields.find(f => f.field_name === 'item_domain')?.value === 'other_non_grocery');
  if (filter === 'harness-suspicious') filteredItems = summary.items.filter(i => i.harness_issue_codes && i.harness_issue_codes.length > 0);
  if (filter === 'harness-critical') filteredItems = summary.items.filter(i => i.harness_issue_codes && i.harness_issue_codes.some(c => ['size_misclassified_as_price','offer_price_matches_size_value','original_price_misclassified_as_offer_price','missing_offer_price','ambiguous_offer_price','missing_product_title','comparison_eligible_null_unit_price','publishable_with_blocking_errors'].includes(c)));
  if (filter === 'fixture-candidates') filteredItems = summary.items.filter(i => i.harness_issue_codes && i.harness_issue_codes.length > 0);
  if (filter === 'unresolved-page') filteredItems = summary.items.filter(i => i.page_first_diagnostics?.page_unresolved);
  if (filter === 'unmatched-evidence') filteredItems = summary.items.filter(i => i.page_first_diagnostics?.has_unmatched_evidence);
  if (filter === 'low-crop-confidence') filteredItems = summary.items.filter(i => i.page_first_diagnostics?.crop_confidence !== null && i.page_first_diagnostics?.crop_confidence !== undefined && i.page_first_diagnostics.crop_confidence < 0.8);
  if (filter === 'retried-page') filteredItems = summary.items.filter(i => i.page_first_diagnostics?.source_pass === 'retry');
  if (filter === 'uncovered-anchor') filteredItems = summary.items.filter(i => i.page_first_diagnostics?.uncovered_price_anchor_on_page);

  const harnessSuspiciousCount = summary.items.filter(i => i.harness_issue_codes && i.harness_issue_codes.length > 0).length;
  const hasPageFirstItems = summary.items.some(i => i.page_first_diagnostics !== undefined);
  const unresolvedPageCount = summary.items.filter(i => i.page_first_diagnostics?.page_unresolved).length;
  const unmatchedEvidenceCount = summary.items.filter(i => i.page_first_diagnostics?.has_unmatched_evidence).length;
  const lowCropConfCount = summary.items.filter(i => i.page_first_diagnostics?.crop_confidence !== null && i.page_first_diagnostics?.crop_confidence !== undefined && i.page_first_diagnostics.crop_confidence < 0.8).length;
  const retriedCount = summary.items.filter(i => i.page_first_diagnostics?.source_pass === 'retry').length;
  const uncoveredAnchorCount = summary.items.filter(i => i.page_first_diagnostics?.uncovered_price_anchor_on_page).length;

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: '#f1f5f9', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', backgroundColor: 'white', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 8px 0' }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Pre-Publish Preview</h2>
            {isDryRun && !rehearsalMode && <span style={{ padding: '2px 6px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: '#fef08a', color: '#854d0e', borderRadius: '4px', border: '1px solid #fde047' }}>DRY RUN MODE</span>}
            {qaMode && <span style={{ padding: '2px 6px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: '#e0e7ff', color: '#3730a3', borderRadius: '4px', border: '1px solid #c7d2fe' }}>QA PACKAGE</span>}
            {rehearsalMode && <span style={{ padding: '2px 6px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: '#fecaca', color: '#991b1b', borderRadius: '4px', border: '1px solid #f87171' }}>REAL PUBLISH REHEARSAL MODE</span>}
          </div>
          <div style={{ fontSize: '0.9rem', color: '#64748b' }}>
            {summary.supermarket_name} | {summary.location_label} | {summary.offer_start_date} to {summary.offer_end_date}
          </div>
          <div style={{ marginTop: '12px', display: 'flex', gap: '16px', fontSize: '0.85rem' }}>
            <span style={{ color: '#0f172a' }}><strong>Total:</strong> {summary.counts.total_items}</span>
            <span style={{ color: '#16a34a' }}><strong>Will Publish:</strong> {summary.counts.publish}</span>
            <span style={{ color: '#0284c7' }}><strong>Publish (No Comp):</strong> {summary.counts.publish_but_exclude_from_comparison}</span>
            <span style={{ color: '#dc2626' }}><strong>Skipped:</strong> {summary.counts.skip_or_quarantine}</span>
            <span style={{ color: '#ca8a04' }}><strong>Warnings:</strong> {summary.counts.warnings}</span>
            <span style={{ color: '#b91c1c' }}><strong>Errors:</strong> {summary.counts.blocking_errors}</span>
          </div>
          {harnessGate && (
            <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: '8px', border: '1px solid', borderColor: harnessGate.decision === 'pass' ? '#bbf7d0' : harnessGate.decision === 'pass_with_warnings' ? '#fde68a' : harnessGate.decision === 'needs_human_review' ? '#fed7aa' : '#fca5a5', backgroundColor: harnessGate.decision === 'pass' ? '#f0fdf4' : harnessGate.decision === 'pass_with_warnings' ? '#fefce8' : harnessGate.decision === 'needs_human_review' ? '#fff7ed' : '#fef2f2', fontSize: '0.85rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                Runtime Accuracy Gate: {harnessGate.decision === 'pass' ? '✅ PASS' : harnessGate.decision === 'pass_with_warnings' ? '⚠️ PASS WITH WARNINGS' : harnessGate.decision === 'needs_human_review' ? '🔍 NEEDS HUMAN REVIEW' : '🚫 BLOCKED'}
              </div>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <span>Critical failures: <strong>{harnessGate.critical_failure_count}</strong></span>
                <span>Suspicious rows: <strong>{harnessGate.suspicious_row_count}</strong></span>
                <span>Fixture candidates: <strong>{harnessGate.fixture_candidate_count}</strong></span>
                <span>Style profile failures: <strong>{harnessGate.page_style_profile_failure_count}</strong></span>
              </div>
            </div>
          )}
          {summary.page_style_profile_status && (
            <div style={{ marginTop: '8px', fontSize: '0.85rem', color: '#475569' }}>
              <strong>Page Style Profiles:</strong> {summary.page_style_profile_status.mode === 'disabled' ? 'Disabled' : summary.page_style_profile_status.status === 'completed' ? 'Completed' : summary.page_style_profile_status.status === 'completed_with_warnings' ? 'Completed with Warnings' : 'Missing/Failed'}
              <span style={{ marginLeft: '12px' }}>Completed: <strong>{summary.page_style_profile_status.completed_pages}</strong></span>
              <span style={{ marginLeft: '12px', color: summary.page_style_profile_status.failed_pages > 0 ? '#b91c1c' : 'inherit' }}>Failed: <strong>{summary.page_style_profile_status.failed_pages}</strong></span>
              <span style={{ marginLeft: '12px', color: summary.page_style_profile_status.missing_pages > 0 ? '#ca8a04' : 'inherit' }}>Missing: <strong>{summary.page_style_profile_status.missing_pages}</strong></span>
            </div>
          )}
          {rehearsalMode && (
            <div style={{ marginTop: '8px', fontSize: '0.85rem', color: rehearsalGates?.ok ? '#15803d' : '#b91c1c' }}>
              <strong>Rehearsal Status:</strong> {rehearsalGates?.ok ? `Ready to rehearse ${eligibleCount} rows. Target: ${rehearsalGates.targetClassification}` : rehearsalGates?.blockedReason || 'Checking gates...'}
              {rehearsalGates?.warning && <span style={{ marginLeft: 8, color: '#ca8a04' }}>{rehearsalGates.warning}</span>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button 
            id="preview-back-btn"
            className="btn btn-secondary" 
            onClick={onBack || onClose} 
            disabled={publishing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
          >
            ← {backButtonText || 'Back'}
          </button>
          {rehearsalMode && isDryRun && (
            <div style={{ color: '#b91c1c', fontSize: '0.85rem', maxWidth: '200px' }}>Real publish rehearsal is blocked because dry-run mode is enabled.</div>
          )}
          <button 
            id="publish-to-database-btn"
            className="btn btn-primary" 
            onClick={handlePublishClick}
            disabled={(!canPublish && !isDryRun) || (rehearsalMode && isDryRun) || (rehearsalMode && !rehearsalGates?.ok) || harnessBlocked}
            style={{ fontWeight: 'bold', padding: '10px 24px', backgroundColor: isDryRun ? '#eab308' : (rehearsalMode ? '#ef4444' : undefined), color: (isDryRun || rehearsalMode) ? 'white' : undefined }}
          >
            {publishing ? 'Publishing...' : (isDryRun ? 'Dry Run Publish' : (rehearsalMode ? 'Run Real Publish Rehearsal' : 'Publish to Database'))}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ padding: '12px 24px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <FilterBtn active={filter==='all'} onClick={() => setFilter('all')}>All ({summary.counts.total_items})</FilterBtn>
        <FilterBtn active={filter==='publish'} onClick={() => setFilter('publish')}>Will Publish ({summary.counts.publish})</FilterBtn>
        <FilterBtn active={filter==='exclude'} onClick={() => setFilter('exclude')}>Publish but Excluded ({summary.counts.publish_but_exclude_from_comparison})</FilterBtn>
        <FilterBtn active={filter==='skip'} onClick={() => setFilter('skip')}>Skipped/Quarantine ({summary.counts.skip_or_quarantine})</FilterBtn>
        <FilterBtn active={filter==='warnings'} onClick={() => setFilter('warnings')}>Warnings ({summary.counts.warnings})</FilterBtn>
        <FilterBtn active={filter==='errors'} onClick={() => setFilter('errors')}>Errors ({summary.counts.blocking_errors})</FilterBtn>
        <FilterBtn active={filter==='non-grocery'} onClick={() => setFilter('non-grocery')}>Non-Grocery ({summary.counts.non_grocery})</FilterBtn>
        <FilterBtn active={filter==='harness-suspicious'} onClick={() => setFilter('harness-suspicious')}>Harness Suspicious ({harnessSuspiciousCount})</FilterBtn>
        <FilterBtn active={filter==='harness-critical'} onClick={() => setFilter('harness-critical')}>Harness Critical</FilterBtn>
        <FilterBtn active={filter==='fixture-candidates'} onClick={() => setFilter('fixture-candidates')}>Fixture Candidates ({harnessGate?.fixture_candidate_count ?? 0})</FilterBtn>
        {hasPageFirstItems && (
          <>
            <FilterBtn active={filter==='unresolved-page'} onClick={() => setFilter('unresolved-page')}>Unresolved Page ({unresolvedPageCount})</FilterBtn>
            <FilterBtn active={filter==='unmatched-evidence'} onClick={() => setFilter('unmatched-evidence')}>Unmatched Evidence ({unmatchedEvidenceCount})</FilterBtn>
            <FilterBtn active={filter==='low-crop-confidence'} onClick={() => setFilter('low-crop-confidence')}>Low Crop Conf ({lowCropConfCount})</FilterBtn>
            <FilterBtn active={filter==='retried-page'} onClick={() => setFilter('retried-page')}>Retried Page ({retriedCount})</FilterBtn>
            <FilterBtn active={filter==='uncovered-anchor'} onClick={() => setFilter('uncovered-anchor')}>Uncovered Anchor ({uncoveredAnchorCount})</FilterBtn>
          </>
        )}
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '24px' }}>
          {filteredItems.map(item => (
            <PrePublishItemCard key={`${item.source_page_number}-${item.source_item_number}`} item={item} />
          ))}
          {filteredItems.length === 0 && <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#64748b' }}>No items match filter.</div>}
        </div>
      </div>

      {/* Confirm Modal */}
      {showConfirm && (
        <div 
          id="publish-confirmation-modal"
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div className="card" style={{ width: '540px', padding: '28px', backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.25rem', color: '#0f172a' }}>
              {rehearsalMode 
                ? 'Confirm Real Publish Rehearsal' 
                : (isDryRun ? 'Confirm Dry Run Publish' : 'Confirm Publish to Database')}
            </h3>

            <div style={{ padding: '16px', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
              <div style={{ marginBottom: '10px' }}>
                <span style={{ color: '#64748b', fontSize: '0.85rem', display: 'block' }}>Supermarket</span>
                <strong style={{ color: '#0f172a', fontSize: '1rem' }}>{summary.supermarket_name || 'N/A'}</strong>
              </div>
              <div style={{ marginBottom: '10px' }}>
                <span style={{ color: '#64748b', fontSize: '0.85rem', display: 'block' }}>Location</span>
                <strong style={{ color: '#0f172a', fontSize: '1rem' }}>{summary.location_label || 'National'}</strong>
              </div>
              <div style={{ marginBottom: '10px' }}>
                <span style={{ color: '#64748b', fontSize: '0.85rem', display: 'block' }}>Leaflet / Validity</span>
                <strong style={{ color: '#0f172a', fontSize: '1rem' }}>
                  {summary.leaflet_id ? `${summary.leaflet_id} (${summary.offer_start_date} to ${summary.offer_end_date})` : `${summary.offer_start_date} to ${summary.offer_end_date}`}
                </strong>
              </div>
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '10px', marginTop: '10px' }}>
                <span style={{ color: '#64748b', fontSize: '0.85rem', display: 'block' }}>Offers to be Published</span>
                <strong style={{ color: '#16a34a', fontSize: '1.2rem' }}>{eligibleCount} offers</strong>
                <span style={{ color: '#64748b', fontSize: '0.85rem', marginLeft: '8px' }}>
                  ({summary.counts.publish} comparison-eligible, {summary.counts.publish_but_exclude_from_comparison} excluded from comparison)
                </span>
              </div>
              {summary.counts.skip_or_quarantine > 0 && (
                <div style={{ marginTop: '6px' }}>
                  <span style={{ color: '#64748b', fontSize: '0.85rem' }}>Skipped / Quarantined: </span>
                  <strong style={{ color: '#dc2626', fontSize: '0.85rem' }}>{summary.counts.skip_or_quarantine} offers</strong>
                </div>
              )}
            </div>

            <p style={{ fontSize: '0.9rem', color: '#475569', marginBottom: '20px', lineHeight: 1.5 }}>
              {isDryRun && !rehearsalMode ? (
                <>No images will be uploaded and no offers will be written to Supabase in dry run mode.</>
              ) : (
                <>
                  Publishing will upload crop images and write <strong>{eligibleCount}</strong> offers to the production Wifran database.
                  This action is manual and cannot be undone. Are you sure you want to proceed?
                </>
              )}
            </p>

            {rehearsalMode && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '8px', color: '#334155' }}>
                  Type PUBLISH VERIFIED REHEARSAL to continue
                </label>
                <input 
                  type="text" 
                  value={typedConfirmation}
                  onChange={e => setTypedConfirmation(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                  placeholder="PUBLISH VERIFIED REHEARSAL"
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button 
                id="cancel-publish-button"
                className="btn" 
                onClick={() => setShowConfirm(false)}
                style={{ padding: '8px 18px' }}
              >
                Cancel
              </button>
              <button 
                id="confirm-publish-button"
                className="btn btn-primary" 
                onClick={() => { setShowConfirm(false); handleConfirmPublish(); }}
                disabled={rehearsalMode && typedConfirmation !== 'PUBLISH VERIFIED REHEARSAL'}
                style={{ 
                  padding: '8px 22px', 
                  fontWeight: 600, 
                  backgroundColor: isDryRun ? '#eab308' : (rehearsalMode ? '#ef4444' : '#16a34a'),
                  color: 'white'
                }}
              >
                {isDryRun && !rehearsalMode ? 'Confirm Dry Run' : 'Approve & Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterBtn({ active, onClick, children }: any) {
  return (
    <button 
      onClick={onClick}
      style={{ 
        padding: '6px 12px', 
        borderRadius: '20px', 
        border: `1px solid ${active ? '#2563eb' : '#cbd5e1'}`,
        backgroundColor: active ? '#eff6ff' : 'white',
        color: active ? '#1d4ed8' : '#334155',
        cursor: 'pointer',
        fontSize: '0.85rem'
      }}
    >
      {children}
    </button>
  );
}

const FIELD_LABEL_MAP: Record<string, string> = {
  source_page_number: 'Page Number',
  source_item_number: 'Item Number',
  title_ar: 'Title (Arabic)',
  title_en: 'Title (English)',
  brand_text: 'Brand',
  category_hint: 'Category',
  item_domain: 'Domain',
  offer_price: 'Offer Price',
  original_price: 'Original Price',
  currency: 'Currency',
  size_text: 'Size',
  pack_quantity: 'Pack Quantity',
  bundle_quantity: 'Bundle Quantity',
  each_size_value: 'Each Size Value',
  each_size_unit: 'Each Size Unit',
  total_content_value: 'Total Content Value',
  total_content_unit: 'Total Content Unit',
  price_basis: 'Price Basis',
  promotion_mechanic: 'Promotion Mechanic',
  condition_text: 'Condition',
  comparison_eligible: 'Comparison Eligible',
  comparison_unit: 'Comparison Unit',
  comparison_unit_price: 'Comparison Unit Price',
  comparison_exclusion_reason: 'Comparison Exclusion Reason',
  display_unit_price_label_ar: 'Unit Price Label (Arabic)',
  display_unit_price_label_en: 'Unit Price Label (English)',
  publish_decision: 'Publish Decision'
};

function formatFieldLabel(fieldName: string): string {
  if (FIELD_LABEL_MAP[fieldName]) {
    return FIELD_LABEL_MAP[fieldName];
  }
  return fieldName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function shouldDisplayField(fieldName: string, value: unknown): boolean {
  if (fieldName === 'display_unit_price_hidden_reason') return false;

  if (value === null || value === undefined) return false;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '—' || trimmed === '-' || trimmed === 'null' || trimmed === 'undefined') {
      return false;
    }
    const lower = trimmed.toLowerCase();
    if (
      lower === 'missing' ||
      lower.startsWith('missing_') ||
      lower.startsWith('missing ') ||
      lower === 'not_available' ||
      lower === 'none' ||
      lower === 'n/a'
    ) {
      return false;
    }
  }

  return true;
}

function formatFieldValue(value: unknown): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return String(value);
}

function PrePublishItemCard({ item }: { item: PrePublishPreviewItem }) {
  const [expanded, setExpanded] = useState(false);
  
  const isSkip = item.publish_decision === 'skip_or_quarantine';
  const isPublishExclude = item.publish_decision === 'publish_but_exclude_from_comparison';

  const badgeColor = isSkip ? '#fef2f2' : isPublishExclude ? '#f0f9ff' : '#f0fdf4';
  const badgeBorder = isSkip ? '#fca5a5' : isPublishExclude ? '#bae6fd' : '#bbf7d0';
  const badgeText = isSkip ? '#991b1b' : isPublishExclude ? '#0369a1' : '#166534';

  const imgUrl = `local-file://get?path=${encodeURIComponent(item.crop_path)}`;

  const titleAr = item.fields.find(f => f.field_name === 'title_ar')?.value;
  const titleEn = item.fields.find(f => f.field_name === 'title_en')?.value;
  const offerPrice = item.fields.find(f => f.field_name === 'offer_price')?.value;
  const originalPrice = item.fields.find(f => f.field_name === 'original_price')?.value;
  const currency = item.fields.find(f => f.field_name === 'currency')?.value || 'ر.س';
  const unitPriceLabelAr = item.fields.find(f => f.field_name === 'display_unit_price_label_ar')?.value;
  const unitPriceLabelEn = item.fields.find(f => f.field_name === 'display_unit_price_label_en')?.value;

  const displayableFields = item.fields.filter(f => shouldDisplayField(f.field_name, f.value));

  return (
    <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ height: '200px', backgroundColor: '#f1f5f9', borderRadius: '8px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img 
          src={imgUrl} 
          alt={`Crop ${item.source_item_number}`}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="10" y="50" font-size="12">Image Missing</text></svg>'; }}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '0.8rem' }}>
        <span style={{ padding: '2px 8px', borderRadius: '12px', backgroundColor: badgeColor, border: `1px solid ${badgeBorder}`, color: badgeText, fontWeight: 600 }}>
          {item.publish_decision}
        </span>
        <span style={{ padding: '2px 8px', borderRadius: '12px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}>
          Conf: {item.confidence}
        </span>
        <span style={{ padding: '2px 8px', borderRadius: '12px', backgroundColor: item.comparison_eligible ? '#f0fdf4' : '#fef2f2', border: `1px solid ${item.comparison_eligible ? '#bbf7d0' : '#fca5a5'}`, color: item.comparison_eligible ? '#166534' : '#991b1b' }}>
          Comp: {item.comparison_eligible ? 'Eligible' : 'Excluded'}
        </span>
        {item.blocking_errors.length > 0 && (
          <span style={{ padding: '2px 8px', borderRadius: '12px', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b' }}>
            {item.blocking_errors.length} Errors
          </span>
        )}
        {item.non_blocking_warnings.length > 0 && (
          <span style={{ padding: '2px 8px', borderRadius: '12px', backgroundColor: '#fefce8', border: '1px solid #fde68a', color: '#854d0e' }}>
            {item.non_blocking_warnings.length} Warns
          </span>
        )}
        {item.harness_issue_codes && item.harness_issue_codes.length > 0 && (
          <span style={{ padding: '2px 8px', borderRadius: '12px', backgroundColor: '#fef3c7', border: '1px solid #fbbf24', color: '#92400e', fontWeight: 600 }}>
            🔍 {item.harness_issue_codes.length} Harness
          </span>
        )}
        {item.page_first_diagnostics && (
          <>
            <span style={{ padding: '2px 8px', borderRadius: '12px', backgroundColor: '#e0e7ff', border: '1px solid #c7d2fe', color: '#3730a3', fontWeight: 600 }}>
              PF: {item.page_first_diagnostics.source_pass === 'retry' ? 'Retry Pass' : 'Primary Pass'}
            </span>
            <span style={{ padding: '2px 8px', borderRadius: '12px', backgroundColor: item.page_first_diagnostics.current_price_anchor_matched ? '#dcfce7' : '#fee2e2', border: `1px solid ${item.page_first_diagnostics.current_price_anchor_matched ? '#86efac' : '#fca5a5'}`, color: item.page_first_diagnostics.current_price_anchor_matched ? '#15803d' : '#b91c1c' }}>
              Anchor: {item.page_first_diagnostics.current_price_anchor_matched ? 'Matched' : 'Missing'}
            </span>
            {item.page_first_diagnostics.crop_confidence !== null && (
              <span style={{ padding: '2px 8px', borderRadius: '12px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', color: '#334155' }}>
                Crop Conf: {Math.round(item.page_first_diagnostics.crop_confidence * 100)}%
              </span>
            )}
            {item.page_first_diagnostics.evidence_link_confidence !== null && (
              <span style={{ padding: '2px 8px', borderRadius: '12px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', color: '#334155' }}>
                Link Conf: {Math.round(item.page_first_diagnostics.evidence_link_confidence * 100)}%
              </span>
            )}
            {item.page_first_diagnostics.has_unmatched_evidence && (
              <span style={{ padding: '2px 8px', borderRadius: '12px', backgroundColor: '#fef3c7', border: '1px solid #fcd34d', color: '#b45309' }}>
                Unmatched Evidence
              </span>
            )}
            {item.page_first_diagnostics.uncovered_price_anchor_on_page && (
              <span style={{ padding: '2px 8px', borderRadius: '12px', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c' }}>
                Uncovered Anchor
              </span>
            )}
          </>
        )}
      </div>

      {/* Product Title (Arabic & English) */}
      {(titleAr || titleEn) && (
        <div style={{ textAlign: 'center', padding: '0 4px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {titleAr && (
            <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a', lineHeight: 1.35, wordBreak: 'break-word' }}>
              {String(titleAr)}
            </div>
          )}
          {titleEn && (
            <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: titleAr ? '2px' : 0, lineHeight: 1.3, wordBreak: 'break-word' }}>
              {String(titleEn)}
            </div>
          )}
        </div>
      )}

      {/* Price Box */}
      <div style={{ textAlign: 'center', margin: '2px 0 6px 0', padding: '8px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#0f172a' }}>
          {offerPrice !== null && offerPrice !== undefined ? `${offerPrice} ${currency}` : '—'}
        </div>
        {originalPrice && (
          <div style={{ fontSize: '0.8rem', color: '#94a3b8', textDecoration: 'line-through' }}>
            {originalPrice} {currency}
          </div>
        )}
        {(unitPriceLabelAr || unitPriceLabelEn) && (
          <div style={{ fontSize: '0.85rem', color: '#0284c7', marginTop: '4px', fontWeight: 500 }}>
            {unitPriceLabelAr ? String(unitPriceLabelAr) : String(unitPriceLabelEn)}
          </div>
        )}
      </div>

      {/* Toggle Details Button & Expandable Content */}
      <div>
        <button 
          id={`toggle-details-btn-${item.source_item_number}`}
          onClick={() => setExpanded(!expanded)}
          style={{ 
            width: '100%', 
            padding: '8px 12px', 
            backgroundColor: expanded ? '#f1f5f9' : '#ffffff', 
            border: '1px solid #cbd5e1', 
            borderRadius: '6px', 
            cursor: 'pointer', 
            fontSize: '0.82rem', 
            fontWeight: 600,
            color: '#334155',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            transition: 'all 0.15s ease'
          }}
        >
          <span>{expanded ? '▲ Hide Details' : '▼ Show Details'}</span>
        </button>

        {expanded && (
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Blocking Errors */}
            {item.blocking_errors.length > 0 && (
              <div style={{ padding: '8px 12px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#991b1b', fontSize: '0.8rem' }}>
                <strong style={{ display: 'block', marginBottom: '4px' }}>⚠️ Blocking Errors:</strong>
                <ul style={{ margin: 0, paddingLeft: '18px' }}>
                  {item.blocking_errors.map((e, idx) => (
                    <li key={idx} style={{ lineHeight: 1.35 }}>{e.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Non-blocking Warnings */}
            {item.non_blocking_warnings.length > 0 && (
              <div style={{ padding: '8px 12px', backgroundColor: '#fefce8', border: '1px solid #fef08a', borderRadius: '6px', color: '#854d0e', fontSize: '0.8rem' }}>
                <strong style={{ display: 'block', marginBottom: '4px' }}>⚠️ Warnings:</strong>
                <ul style={{ margin: 0, paddingLeft: '18px' }}>
                  {item.non_blocking_warnings.map((w, idx) => (
                    <li key={idx} style={{ lineHeight: 1.35 }}>{w.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Details Table */}
            {displayableFields.length > 0 ? (
              <div style={{ fontSize: '0.82rem', border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <tbody>
                    {displayableFields.map((f, i) => (
                      <tr 
                        key={f.field_name} 
                        style={{ 
                          backgroundColor: i % 2 === 0 ? '#ffffff' : '#f8fafc', 
                          borderBottom: i === displayableFields.length - 1 ? 'none' : '1px solid #f1f5f9' 
                        }}
                      >
                        <td 
                          style={{ 
                            padding: '6px 10px', 
                            fontWeight: 600, 
                            color: '#475569', 
                            width: '44%', 
                            whiteSpace: 'normal', 
                            wordBreak: 'break-word',
                            lineHeight: 1.35,
                            verticalAlign: 'top' 
                          }}
                        >
                          {formatFieldLabel(f.field_name)}
                        </td>
                        <td 
                          style={{ 
                            padding: '6px 10px', 
                            color: '#0f172a', 
                            width: '56%',
                            whiteSpace: 'normal', 
                            wordBreak: 'break-word',
                            lineHeight: 1.35,
                            verticalAlign: 'top' 
                          }}
                        >
                          {formatFieldValue(f.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: '12px', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem', fontStyle: 'italic' }}>
                No additional details available
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
