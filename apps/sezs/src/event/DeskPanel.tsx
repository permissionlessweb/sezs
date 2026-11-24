import {
  blockerCopy,
  emptyStatus,
  withInflow,
} from '../frost/ceremony'
import { AuthSession } from '../auth/types'

/** Crew desk. Uses frost ceremony blockers. No KeyPackages. */
export const DeskPanel = ({ session }: { session: AuthSession }) => {
  const base = emptyStatus()
  const status = session.paid?.recordId
    ? withInflow(base, {
        recordId: session.paid.recordId,
        rail: session.paid.rail,
        amountLabel: session.paid.rail,
      })
    : base
  const admin = session.role === 'admin'
  const blockers = admin
    ? status.blockers
    : ([...status.blockers, 'not_admin'] as typeof status.blockers)

  return (
    <div className="panel">
      <p>
        {session.alias} · {session.role}
        {session.paid
          ? ` · inflow ${session.paid.rail}`
          : ' · no confirmed inflow'}
      </p>
      <ul className="muted">
        {blockers.map((b) => (
          <li key={b}>{blockerCopy[b]}</li>
        ))}
      </ul>
      <p className="muted">20% and 80% are sends, not flags on this page.</p>
    </div>
  )
}
