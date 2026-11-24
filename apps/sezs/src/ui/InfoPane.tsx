import { ReactNode } from 'react'

export type InfoFact = { label: string; value: string }

export const InfoFacts = ({ facts }: { facts: InfoFact[] }) => (
  <dl className="wallet-facts">
    {facts.map((f) => (
      <div className="wallet-fact" key={f.label}>
        <dt>{f.label}</dt>
        <dd>{f.value}</dd>
      </div>
    ))}
  </dl>
)

export const InfoButton = ({
  on,
  onClick,
  label,
}: {
  on: boolean
  onClick: () => void
  label: string
}) => (
  <button
    type="button"
    className={'wallet-info-btn' + (on ? ' is-on' : '')}
    aria-pressed={on}
    aria-label={label}
    onClick={onClick}
  >
    i
  </button>
)

export const InfoHead = ({
  title,
  on,
  onClick,
  label,
  children,
}: {
  title: ReactNode
  on: boolean
  onClick: () => void
  label: string
  children?: ReactNode
}) => (
  <div className="wallet-pane-head info-head">
    <h3 className="wallet-pane-title">{title}</h3>
    {children}
    <InfoButton on={on} onClick={onClick} label={label} />
  </div>
)
