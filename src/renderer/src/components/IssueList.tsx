import { PipelineRowIssue } from '../../../shared/types/pipelineSummary'

type IssueListProps = {
  issues: PipelineRowIssue[]
  compact?: boolean
}

export function IssueList({ issues, compact = false }: IssueListProps) {
  if (!issues || issues.length === 0) return null

  return (
    <ul style={{ 
      margin: 0, 
      paddingLeft: compact ? '16px' : '20px', 
      listStyleType: 'disc',
      fontSize: compact ? '0.75rem' : '0.85rem'
    }}>
      {issues.map((issue, idx) => (
        <li key={idx} style={{ 
          marginBottom: compact ? '2px' : '4px',
          color: issue.severity === 'error' ? '#f87171' : issue.severity === 'warning' ? '#fbbf24' : '#60a5fa'
        }}>
          <strong>{issue.code}</strong>
          {issue.fieldName ? ` [${issue.fieldName}]` : ''}: {issue.message}
        </li>
      ))}
    </ul>
  )
}
