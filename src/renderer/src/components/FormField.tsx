import React from 'react'
import type { ImportFormValidationError } from '../../../shared/types/importForm'

type FormFieldProps = {
  label: string
  children: React.ReactNode
  helperText?: React.ReactNode
  errors?: ImportFormValidationError[]
  fieldKey?: string
}

export function FormField({ label, children, helperText, errors = [], fieldKey }: FormFieldProps): JSX.Element {
  const fieldErrors = fieldKey ? errors.filter(e => e.field === fieldKey) : []

  return (
    <div className={`form-group ${fieldErrors.length > 0 ? 'has-error' : ''}`}>
      <label>{label}</label>
      {children}
      {helperText && !fieldErrors.length && <p className="help-text">{helperText}</p>}
      {fieldErrors.length > 0 && (
        <div style={{ color: 'red', fontSize: '0.85rem', marginTop: '4px' }}>
          {fieldErrors.map((err, i) => (
            <div key={i}>{err.message}</div>
          ))}
        </div>
      )}
    </div>
  )
}
