import { PageHeader } from '../components/PageHeader'
import { ImageEnrichmentWorkflow } from '../components/catalog/ImageEnrichmentWorkflow'

export function ImageEnrichmentPage(): JSX.Element {
  return (
    <div className="page-container" style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 16px' }}>
      <PageHeader
        title="Hybrid Image Enrichment (WIFRAN-07J)"
        description="End-to-end visual enrichment workflow: Export hybrid candidate search CSV (Step 1) and import approved image candidate URLs with zero-network offline validation, dual-routing, and SHA-256 deduplication (Step 3)."
      />

      <div style={{ marginTop: '24px' }}>
        <ImageEnrichmentWorkflow />
      </div>
    </div>
  )
}

