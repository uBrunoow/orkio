export function Alert({
  tone,
  children
}: {
  tone: 'danger' | 'warning'
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={`alert alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="alert__icon" aria-hidden="true">
        !
      </span>
      <div className="alert__body">{children}</div>
    </div>
  )
}
