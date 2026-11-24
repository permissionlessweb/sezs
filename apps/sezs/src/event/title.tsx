import { ReactNode } from 'react'

/** Display the on-chain event name. Never falls back to a hardcoded night. */
export const eventNameOf = (name?: string | null) => {
  const n = String(name || '').trim()
  return n || 'The event'
}

export const eventTitleBreak = (name?: string | null): ReactNode => {
  const n = eventNameOf(name)
  const parts = n.split(/\s+/)
  if (parts.length >= 2) {
    return (
      <>
        {parts[0]}
        <br />
        {parts.slice(1).join(' ')}
      </>
    )
  }
  return n
}
