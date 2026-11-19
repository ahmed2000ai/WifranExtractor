import { useState, useEffect } from 'react'
import { ImportPage } from './pages/ImportPage'
import { ResultsPage } from './pages/ResultsPage'
import { SettingsPage } from './pages/SettingsPage'
import { LogsPage } from './pages/LogsPage'
import { ImageEnrichmentPage } from './pages/ImageEnrichmentPage'
import { PipelineProvider } from './context/PipelineContext'
import { useAppHealth } from './hooks/useAppHealth'
import { StatusBadge } from './components/StatusBadge'

function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState('import')
  const { health } = useAppHealth()
  const isOfflineUat = Boolean(health?.isOfflineUat)

  useEffect(() => {
    if (!health) return
    document.title = health.isOfflineUat
      ? 'Wifran Offers Extractor [OFFLINE UAT - SIMULATED]'
      : 'Wifran Offers Extractor'
  }, [health])

  useEffect(() => {
    const handleSwitchTab = (e: any) => {
      const target = e.detail
      if (typeof target === 'string' && ['import', 'enrichment', 'results', 'logs', 'settings'].includes(target)) {
        setActiveTab(target)
      }
    }
    window.addEventListener('app:switch-tab', handleSwitchTab)
    return () => window.removeEventListener('app:switch-tab', handleSwitchTab)
  }, [])

  return (
    <PipelineProvider>
      <div className="app-layout">
        <header className="app-header">
          <div className="header-brand">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <h1>Wifran Offers Extractor</h1>
              {isOfflineUat && (
                <span
                  data-testid="offline-uat-pill"
                  style={{
                    backgroundColor: '#7c3aed',
                    color: '#ffffff',
                    padding: '4px 12px',
                    borderRadius: '9999px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    border: '1px solid #c4b5fd',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span>🛡️ OFFLINE UAT — SIMULATED</span>
                </span>
              )}
              {health?.databaseEnvironment?.context === 'DEVELOPMENT_TEST' && (
                <span
                  data-testid="dev-uat-harness-pill"
                  style={{
                    backgroundColor: '#b45309',
                    color: '#ffffff',
                    padding: '4px 12px',
                    borderRadius: '9999px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    border: '1px solid #fcd34d',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span>⚠️ {health.databaseEnvironment.displayBadge}</span>
                </span>
              )}
            </div>
          </div>
        </header>
        {isOfflineUat && (
          <div
            data-testid="offline-uat-banner"
            style={{
              backgroundColor: '#4c1d95',
              color: '#ede9fe',
              padding: '8px 24px',
              fontSize: '0.82rem',
              fontWeight: 500,
              borderBottom: '1px solid #7c3aed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap'
            }}
          >
            <span>
              <strong>DETERMINISTIC SIMULATION MODE:</strong> Live Gemini/Mistral APIs &amp; remote Supabase writes are strictly blocked.
            </span>
            <span style={{ fontSize: '0.76rem', color: '#ddd6fe' }}>
              Workspaces: <code>workspaces_uat/</code> · Metadata Cache &amp; Ledger: <code>temp/uat_metadata_cache/</code>
            </span>
          </div>
        )}
        <nav className="main-nav">
          <button className={`nav-button ${activeTab === 'import' ? 'active' : ''}`} onClick={() => setActiveTab('import')}>Import</button>
          <button className={`nav-button ${activeTab === 'enrichment' ? 'active' : ''}`} onClick={() => setActiveTab('enrichment')}>Image Enrichment</button>
          <button className={`nav-button ${activeTab === 'results' ? 'active' : ''}`} onClick={() => setActiveTab('results')}>Results</button>
          <button className={`nav-button ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>Logs</button>
          <button className={`nav-button ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>Settings</button>
        </nav>

        <main className="app-content">
          {activeTab === 'import' && <ImportPage />}
          {activeTab === 'enrichment' && <ImageEnrichmentPage />}
          {activeTab === 'results' && <ResultsPage />}
          {activeTab === 'logs' && <LogsPage />}
          {activeTab === 'settings' && <SettingsPage />}
        </main>

        <footer className="app-footer">
          <div className="footer-status">
            <span className="status-item">
              Version: {health?.appVersion || '...'}
            </span>
            <span className="status-item">
              Environment: {health?.environment || '...'}
            </span>
            {isOfflineUat && (
              <span className="status-item" style={{ color: '#6d28d9', fontWeight: 700 }}>
                Mode: OFFLINE UAT — SIMULATED (External Network Blocked)
              </span>
            )}
            <span className="status-item">
              Main Process:{' '}
              <StatusBadge variant={health?.ok ? 'success' : 'error'}>
                {health?.ok ? 'Healthy' : 'Connecting...'}
              </StatusBadge>
            </span>
          </div>
        </footer>
      </div>
    </PipelineProvider>
  )
}

export default App
