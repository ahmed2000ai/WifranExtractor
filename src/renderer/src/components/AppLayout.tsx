import React, { useState } from 'react'
import { Navigation } from './Navigation'
import { useAppHealth } from '../hooks/useAppHealth'
import { StatusBadge } from './StatusBadge'

type AppLayoutProps = {
  children: (activeTab: 'import' | 'results' | 'settings' | 'logs') => React.ReactNode
}

export function AppLayout({ children }: AppLayoutProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<'import' | 'results' | 'settings' | 'logs'>('import')
  const { health } = useAppHealth()

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-brand">
          <h1>Wifran Offers Extractor</h1>
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
