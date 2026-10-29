import React from 'react'

type EmptyStateProps = {
  title: string
  description?: string
  icon?: React.ReactNode
}

export function EmptyState({ title, description, icon }: EmptyStateProps): JSX.Element {
  return (
    <div className="empty-state" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      textAlign: 'center',
      border: '1px dashed #ccc',
      borderRadius: '8px',
      backgroundColor: '#fafafa'
    }}>
      {icon && <div style={{ marginBottom: '16px', color: '#888' }}>{icon}</div>}
      <h3 style={{ margin: '0 0 8px 0', color: '#555' }}>{title}</h3>
      {description && <p style={{ margin: 0, color: '#777', fontSize: '0.9rem' }}>{description}</p>}
    </div>
  )
}
