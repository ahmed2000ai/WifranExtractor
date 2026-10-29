import { useState } from 'react'
import { ImportPage } from './pages/ImportPage'
import { ResultsPage } from './pages/ResultsPage'
import { SettingsPage } from './pages/SettingsPage'
import { LogsPage } from './pages/LogsPage'
import { PipelineProvider } from './context/PipelineContext'

function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState('import')

  return (
    <PipelineProvider>
      <div className="app-layout">
        <header className="app-header">
          <div className="header-brand">
            <h1>Wifran Offers Extractor</h1>
          </div>
        </header>
        <nav className="main-nav">
          <button className={`nav-button ${activeTab === 'import' ? 'active' : ''}`} onClick={() => setActiveTab('import')}>Import</button>
          <button className={`nav-button ${activeTab === 'results' ? 'active' : ''}`} onClick={() => setActiveTab('results')}>Results</button>
          <button className={`nav-button ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>Logs</button>
          <button className={`nav-button ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>Settings</button>
        </nav>

        <main className="app-content">
          {activeTab === 'import' && <ImportPage />}
          {activeTab === 'results' && <ResultsPage />}
          {activeTab === 'logs' && <LogsPage />}
          {activeTab === 'settings' && <SettingsPage />}
        </main>
      </div>
    </PipelineProvider>
  )
}

export default App
