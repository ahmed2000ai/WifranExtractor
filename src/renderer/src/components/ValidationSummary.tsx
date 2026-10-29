import type { ImportFormValidationError } from '../../../shared/types/importForm'

type ValidationSummaryProps = {
  errors: ImportFormValidationError[]
}

export function ValidationSummary({ errors }: ValidationSummaryProps): JSX.Element | null {
  if (errors.length === 0) return null

  return (
    <div style={{
      padding: '12px',
      backgroundColor: '#fee',
      border: '1px solid #fcc',
      borderRadius: '4px',
      marginBottom: '16px'
    }}>
      <h4 style={{ margin: '0 0 8px 0', color: '#c53030' }}>Validation Errors</h4>
      <ul style={{ margin: 0, color: '#c53030', paddingLeft: '20px', fontSize: '0.9rem' }}>
        {errors.map((error, index) => (
          <li key={index}>{error.message}</li>
        ))}
      </ul>
    </div>
  )
}
