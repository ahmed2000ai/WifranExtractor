type PageHeaderProps = {
  title: string
  description?: string
}

export function PageHeader({ title, description }: PageHeaderProps): JSX.Element {
  return (
    <div className="page-header">
      <h2>{title}</h2>
      {description && <p className="page-description">{description}</p>}
    </div>
  )
}
