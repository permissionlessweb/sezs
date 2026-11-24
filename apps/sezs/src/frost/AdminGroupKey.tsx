import { useEffect, useState } from 'react'

type GroupKeyState = {
  ok?: boolean
  ready?: boolean
  t?: number
  n?: number
  verifyingKey?: string
  createdAt?: number
  epoch?: number
  leafCount?: number
  error?: string
}

const shortKey = (hex?: string) => {
  const s = String(hex || '')
  if (s.length <= 16) return s
  return `${s.slice(0, 8)}…${s.slice(-8)}`
}

export const AdminGroupKey = () => {
  const [st, setSt] = useState<GroupKeyState | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/sezs/frost/admin-set', { credentials: 'include', cache: 'no-store' })
      .then((r) => r.json())
      .then((d: GroupKeyState) => {
        if (cancelled) return
        if (!d?.ok) {
          setErr(d?.error || 'unavailable')
          setSt(d)
          return
        }
        setErr('')
        setSt(d)
      })
      .catch(() => {
        if (!cancelled) setErr('unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const threshold =
    typeof st?.t === 'number' && typeof st?.n === 'number' ? `${st.t} of ${st.n}` : null
  const status = err ? 'Unavailable' : st?.ready ? 'Ready' : st ? 'Not ready' : 'Loading'

  return (
    <div className="admin-group-key" data-ready={st?.ready ? '1' : '0'}>
      <div className="admin-badges" role="status">
        <span className={'admin-badge' + (st?.ready ? ' ok' : '')}>{status}</span>
        {threshold ? <span className="admin-badge">{threshold}</span> : null}
        {typeof st?.epoch === 'number' ? <span className="admin-badge">Epoch {st.epoch}</span> : null}
        {typeof st?.leafCount === 'number' ? <span className="admin-badge">{st.leafCount} leaves</span> : null}
      </div>
      {st?.verifyingKey ? (
        <p className="mono fine admin-vk" title={st.verifyingKey}>
          {shortKey(st.verifyingKey)}
        </p>
      ) : null}
    </div>
  )
}
