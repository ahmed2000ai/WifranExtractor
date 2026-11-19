import React, { useState } from 'react'
import { Navigation } from './Navigation'
import { useAppHealth } from '../hooks/useAppHealth'
import { StatusBadge } from './StatusBadge'

type AppLayoutProps = {
  children: (activeTab: 'import' | 'enrichment' | 'results' | 'settings' | 'logs') => React.ReactNode
}

export function AppLayout({ children }: AppLayoutProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<'import' | 'enrichment' | 'results' | 'settings' | 'logs'>('import')
  const { health } = useAppHealth()

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-brand">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1>Wifran Offers Extractor</h1>
            {health?.isOfflineUat && (
              <span
                data-testid="offline-uat-pill"
                style={{
                  backgroundColor: '#7c3aed',
                  color: '#ffffff',
                  padding: '3px 10px',
                  borderRadius: '9999px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>🛡️ OFFLINE UAT — DETERMINISTIC SIMULATION</span>
              </span>
            )}
            {health?.databaseEnvironment?.context === 'DEVELOPMENT_TEST' && (
              <span
                data-testid="dev-uat-harness-pill"
                style={{
                  backgroundColor: '#b45309',
                  color: '#ffffff',
                  padding: '3px 10px',
                  borderRadius: '9999px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>⚠️ Database: DEVELOPMENT — TEST ONLY</span>
              </span>
            )}
          </div>
          <p className="subtitle">Internal desktop tool for supermarket offer extraction</p>
        </div>
      </header>

      <Navigation activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="app-content">
        <div className="content-container">
          {children(activeTab)}
        </div>
      </main>

      <footer className="app-footer">
        <div className="footer-status">
          <span className="status-item">
            Version: {health?.appVersion || '...'}
          </span>
          <span className="status-item">
            Environment: {health?.environment || '...'}
          </span>
          <span className="status-item" data-testid="footer-db-environment">
            Database:{' '}
            <StatusBadge variant={health?.databaseEnvironment?.isValidatedProduction ? 'success' : 'error'}>
              {health?.databaseEnvironment?.isValidatedProduction ? 'PRODUCTION' : (health?.databaseEnvironment?.displayBadge || 'DISCONNECTED')}
            </StatusBadge>
          </span>
          <span className="status-item">
            Main Process:{' '}
            <StatusBadge variant={health?.ok ? 'success' : 'error'}>
              {health?.ok ? 'Healthy' : 'Connecting...'}
            </StatusBadge>
          </span>
        </div>
      </footer>
    </div>
  )
}
