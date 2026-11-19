import { PipelineStageSummary } from '../../../shared/types/pipelineSummary'
import { StatusBadge } from './StatusBadge'

type ProgressTimelineProps = {
  stages: PipelineStageSummary[]
}

export function ProgressTimeline({ stages }: ProgressTimelineProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {stages.map((stage, idx) => (
        <div key={stage.key} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: stage.status === 'completed' ? '#16a34a' : stage.status === 'running' ? '#ca8a04' : stage.status === 'failed' ? '#dc2626' : stage.status === 'partially_completed' ? '#0284c7' : '#64748b', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#fff', fontSize: '0.7rem', fontWeight: 'bold' }}>
            {idx + 1}
          </div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '6px', borderBottom: '1px solid #e2e8f0' }}>
            <div>
              <div style={{ fontWeight: 600, color: '#1e293b' }}>{stage.label}</div>
              {stage.message && <div style={{ fontSize: '0.75rem', color: '#475569' }}>{stage.message}</div>}
            </div>
            <div>
              <StatusBadge status={stage.status} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
