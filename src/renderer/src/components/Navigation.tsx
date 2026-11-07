

type TabId = 'import' | 'enrichment' | 'results' | 'settings' | 'logs'

type NavigationProps = {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

export function Navigation({ activeTab, onTabChange }: NavigationProps): JSX.Element {
  const tabs: { id: TabId; label: string }[] = [
    { id: 'import', label: 'Import' },
    { id: 'enrichment', label: 'Image Enrichment' },
    { id: 'results', label: 'Results' },
    { id: 'settings', label: 'Settings' },
    { id: 'logs', label: 'Logs' }
  ]

  return (
    <nav className="main-nav">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`nav-button ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
