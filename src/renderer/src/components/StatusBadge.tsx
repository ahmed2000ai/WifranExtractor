import React from 'react'

type StatusBadgeProps = {
  status?: string
  variant?: 'success' | 'warning' | 'error' | 'info' | 'default'
  children?: React.ReactNode
}

export function StatusBadge({ status, variant, children }: StatusBadgeProps) {
  let v = variant
  if (!v && status) {
    if (['imported', 'valid', 'matched', 'prepared', 'completed'].includes(status)) v = 'success'
    else if (['warning', 'needs_review', 'needs_review_imported', 'draft', 'partially_completed', 'running'].includes(status)) v = 'warning'
    else if (['error', 'failed'].includes(status)) v = 'error'
    else if (['duplicate'].includes(status)) v = 'error'
    else if (['skipped', 'not_started'].includes(status)) v = 'default'
    else v = 'info'
  }

  const getColors = () => {
    switch (v) {
      case 'success': return { bg: '#166534', text: '#bbf7d0' } // Green
      case 'warning': return { bg: '#854d0e', text: '#fef08a' } // Yellow
      case 'error': return { bg: '#991b1b', text: '#fecaca' } // Red
      case 'info': return { bg: '#0369a1', text: '#bae6fd' } // Blue
      default: return { bg: '#334155', text: '#cbd5e1' } // Gray
    }
  }

  const colors = getColors()
  
  const label = children || (status ? status
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') : '')

  return (
    <span style={{
      backgroundColor: colors.bg,
      color: colors.text,
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '0.75rem',
      fontWeight: 600,
      whiteSpace: 'nowrap'
    }}>
      {label}
    </span>
  )
}
