type SummaryCardProps = {
  title: string
  value: number | string
  subtitle?: string
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info'
}

export function SummaryCard({ title, value, subtitle, variant = 'default' }: SummaryCardProps) {
  const getColors = () => {
    switch (variant) {
      case 'success': return { bg: '#064e3b', border: '#065f46', text: '#34d399', val: '#a7f3d0' }
      case 'warning': return { bg: '#422006', border: '#713f12', text: '#fbbf24', val: '#fde68a' }
      case 'error': return { bg: '#4c0519', border: '#881337', text: '#fb7185', val: '#fecdd3' }
      case 'info': return { bg: '#082f49', border: '#0c4a6e', text: '#38bdf8', val: '#bae6fd' }
      default: return { bg: '#1e293b', border: '#334155', text: '#94a3b8', val: '#f8fafc' }
    }
  }
  const colors = getColors()

  return (
    <div style={{
      backgroundColor: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: '6px',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      minWidth: '140px'
    }}>
      <span style={{ color: colors.text, fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{title}</span>
      <span style={{ color: colors.val, fontSize: '1.8rem', fontWeight: 700, marginTop: '8px' }}>{value}</span>
      {subtitle && <span style={{ color: colors.text, fontSize: '0.75rem', marginTop: '4px' }}>{subtitle}</span>}
    </div>
  )
}
