
import { PageHeader } from '../components/PageHeader'
import { useConfigStatus } from '../hooks/useConfigStatus'
import { useReferenceData } from '../hooks/useReferenceData'
import { StatusBadge } from '../components/StatusBadge'

export function SettingsPage(): JSX.Element {
  const { configStatus: status, loading: configLoading, refresh: loadStatus } = useConfigStatus()
  const { data: refData, loading: refLoading, error: refError, reload: reloadRef } = useReferenceData()



  if (configLoading) return <div>Loading settings...</div>
  if (!status) return <div>Failed to load settings.</div>

  const renderStatusItem = (label: string, item: { configured: boolean; required: boolean }) => (
    <div className="status-row">
      <strong>{label}:</strong>{' '}
      {item.configured ? (
        <StatusBadge variant="success">Configured</StatusBadge>
      ) : (
        <StatusBadge variant={item.required ? 'error' : 'warning'}>
          {item.required ? 'Missing (Required)' : 'Missing (Optional)'}
        </StatusBadge>
      )}
    </div>
  )

  return (
    <div className="page-container">
      <PageHeader 
        title="Environment Configuration" 
        description="This page shows the status of your environment variables. Secrets are kept safe in the main process." 
      />

      {!status.validation.ok && (
        <div style={{ padding: '10px', backgroundColor: '#fee', border: '1px solid #fcc', borderRadius: '4px', marginBottom: '20px' }}>
          <h3 style={{ color: 'red', marginTop: 0 }}>Validation Errors</h3>
          <ul style={{ color: 'red', margin: 0 }}>
            {status.validation.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {status.validation.warnings.length > 0 && (
        <div style={{ padding: '10px', backgroundColor: '#fff3cd', border: '1px solid #ffeeba', borderRadius: '4px', marginBottom: '20px' }}>
          <h3 style={{ color: '#856404', marginTop: 0 }}>Validation Warnings</h3>
          <ul style={{ color: '#856404', margin: 0 }}>
            {status.validation.warnings.map((warn, i) => (
              <li key={i}>{warn}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <section>
          <h3>Supabase</h3>
          {renderStatusItem('URL', status.supabase.url)}
          {renderStatusItem('Service Role Key', status.supabase.serviceRoleKey)}
          {renderStatusItem('Storage Bucket', status.supabase.storageBucket)}
          {renderStatusItem('Anon Key', status.supabase.anonKey)}
        </section>

        <section>
          <h3>Mistral OCR</h3>
          {renderStatusItem('API Key', status.mistral.apiKey)}
          {renderStatusItem('Model', status.mistral.ocrModel)}
          {renderStatusItem('Endpoint', status.mistral.ocrEndpoint)}
        </section>

        <section>
          <h3>OCR Processing</h3>
          <div><strong>Chunk Size:</strong> {status.ocr.chunkSize}</div>
          <div><strong>Max Concurrent:</strong> {status.ocr.maxConcurrentRequests}</div>
          <div><strong>Max Retries:</strong> {status.ocr.maxRetries}</div>
        </section>

        <section>
          <h3>Processing & Debug</h3>
          <div><strong>PDF Render DPI:</strong> {status.pdf.renderDpi}</div>
          <div><strong>Image Output Format:</strong> {status.images.outputFormat}</div>
          <div><strong>Save Intermediate Files:</strong> {status.debug.saveIntermediateFiles ? 'Yes' : 'No'}</div>
        </section>

        <section>
          <h3>Database Reference Data</h3>
          {refLoading && <p>Loading from Supabase...</p>}
          {refError && <p style={{ color: 'red' }}>Error: {refError}</p>}
          {refData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div><strong>Supermarkets loaded:</strong> {refData.supermarkets.length}</div>
              <div><strong>Cities loaded:</strong> {refData.cities.length}</div>
              <div><strong>Regions loaded:</strong> {refData.regions.length}</div>
              <div><strong>Supermarket Mappings loaded:</strong> {refData.supermarketRegions.length}</div>
              <div><strong>Categories loaded:</strong> {refData.categories.length}</div>
              <div><strong>Brands loaded:</strong> {refData.brands.length}</div>
              <div><strong>Units loaded:</strong> {refData.units.length}</div>
            </div>
          )}
        </section>
        <section>
          <h3>Import Behavior</h3>
          <div><strong>Default Status:</strong> {status.importBehavior.importDefaultStatus || status.importBehavior.defaultOfferStatus}</div>
          <div><strong>Needs Review Fallback:</strong> {status.importBehavior.allowNeedsReviewFallback ? 'Enabled' : 'Disabled'}</div>
          <div><strong>Publish Warnings:</strong> {status.importBehavior.publishWarningsAllowed ? 'Allowed' : 'Not Allowed'}</div>
          <div><strong>Data Quality Needs Review Threshold:</strong> {status.importBehavior.dataQualityNeedsReviewThreshold}</div>
        </section>
      </div>

      <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
        <button onClick={loadStatus} className="btn btn-secondary">
          Refresh Config Status
        </button>
        <button onClick={reloadRef} className="btn btn-secondary">
          Reload Reference Data
        </button>
      </div>
    </div>
  )
}
