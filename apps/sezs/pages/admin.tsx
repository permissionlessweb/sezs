import { FormEvent, useEffect, useState } from 'react'

import { useAuth } from '../src/auth/AuthContext'
import { adminGate, isStaffRole } from '../src/auth/adminGate.mjs'
import { fetchSessionRole, hasInboxBackend, sessionUrl } from '../src/auth/session'
import { readBoot } from '../src/event/boot'
import { useEvent } from '../src/event/useEvent'
import { signInComplete } from '../src/auth/types'
import { frostError } from '../src/frost/errors'
import { broadcastJob, createJob, getJob, InboxJob, probeInbox, submitShare } from '../src/frost/inbox'
import { RosterPanel } from '../src/frost/RosterPanel'
import { RosterState } from '../src/frost/rosterChange'
import { findFrostContract, rotateExecuteBody, submitRotateToLab } from '../src/frost/rotateLab'
import { UsherPanel } from '../src/frost/UsherPanel'
import { requireNodeTxid, rosterCommit } from '../src/frost/roster'
import { Frame } from '../src/ui/Frame'
import { Halo, Movement } from '../src/ui/primitives'
import { DoorCashAppQr } from '../src/event/DoorCashAppQr'
import { UsherChat } from '../src/event/UsherChat'
import { ParticipantsPanel } from '../src/frost/ParticipantsPanel'
import { UsherBlePanel } from '../src/ble/UsherBlePanel'
import { AdminGroupKey } from '../src/frost/AdminGroupKey'

type LiveStaffHint = {
  live?: boolean
  role?: string | null
  address?: string
  coordinators?: string[]
  curators?: string[]
}

const Admin = () => {
  const { session, ready, error, openSignIn, signOut } = useAuth()
  const ev = useEvent()
  const [live, setLive] = useState<LiveStaffHint | null>(null)
  const [rolesReady, setRolesReady] = useState(false)
  const [note, setNote] = useState('')
  const [roster, setRoster] = useState<RosterState | null>(null)
  const [commit, setCommit] = useState('')
  const [jobId, setJobId] = useState('')
  const [job, setJob] = useState<InboxJob | null>(null)
  const [txid, setTxid] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'holders' | 'participants' | 'phones'>('holders')
  const [inboxLive, setInboxLive] = useState<boolean | null>(null)
  const [rotateContract, setRotateContract] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const t = new URLSearchParams(window.location.search).get('tab')
      if (t === 'phones' || t === 'participants' || t === 'holders') setTab(t)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const address = session?.wallet?.address || ''
    if (!hasInboxBackend()) {
      if (ev.loading) return
      const coordinators = ev.data?.roles.coordinators || []
      const curators = ev.data?.roles.curators || []
      setLive({
        live: Boolean(ev.data),
        address,
        coordinators,
        curators,
      })
      setRolesReady(true)
      return
    }
    const evContract = readBoot().contract || ''
    const rolesPath = evContract
      ? `${sessionUrl('/sezs/v2/event/roles')}?contract=${encodeURIComponent(evContract)}`
      : sessionUrl('/sezs/v2/event/roles')
    Promise.all([
      fetchSessionRole(evContract || undefined),
      fetch(rolesPath, { credentials: 'include', cache: 'no-store' })
        .then((r) => r.json())
        .catch(() => null),
    ])
      .then(([me, roles]) => {
        if (cancelled) return
        const coordinators = roles?.coordinators || ev.data?.roles.coordinators || []
        const curators = roles?.curators || ev.data?.roles.curators || []
        const hint: LiveStaffHint = {
          live: me.ok ? !!me.live : Array.isArray(roles?.coordinators),
          role: me.ok ? me.role : undefined,
          address: me.ok ? me.login_id || address : address,
          coordinators,
          curators,
        }
        if (!me.ok && (coordinators.length || curators.length)) {
          hint.live = true
          hint.address = address
        }
        setLive(hint)
        setRolesReady(true)
      })
      .catch(() => {
        if (!cancelled) {
          setLive({ live: false })
          setRolesReady(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [session?.wallet?.address, session?.role, ev.loading, ev.data])

  const gate = adminGate({
    ready: ready && rolesReady,
    session,
    live,
  })

  useEffect(() => {
    if (gate !== 'ok') return
    let cancelled = false
    const timeout = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
    void Promise.race([probeInbox(), timeout(1500).then(() => false)]).then((ok) => {
      if (!cancelled) setInboxLive(Boolean(ok))
    })
    if (!hasInboxBackend()) {
      setInboxLive(false)
      setRotateContract(null)
      return
    }
    void Promise.race([findFrostContract(), timeout(1500)]).then((c) => {
      if (!cancelled) setRotateContract(c)
    })
    return () => {
      cancelled = true
    }
  }, [gate])

  const fail = (code?: string) => {
    setNote(frostError(code))
  }

  const hashRoster = async () => {
    if (!roster) return ''
    const hex = await rosterCommit({
      epoch: roster.epoch,
      t: roster.t,
      n: roster.n,
      groupVk: roster.groupVk,
      seats: roster.seats,
    })
    setCommit(hex)
    setNote('')
    return hex
  }

  const onCreateJob = async (e: FormEvent) => {
    e.preventDefault()
    if (gate !== 'ok') return fail('not_admin')
    setBusy(true)
    try {
      const hex = commit || (await hashRoster())
      if (!hex) return fail('roster_commit_required')
      const res = await createJob({
        pay_code: 'pay-20-ink',
        roster_commit: hex,
        scheme: 'RedPallas',
        target: 'Zcash',
      })
      if (!res.ok) return fail(res.error)
      setJobId(res.id || '')
      setJob(res)
      setNote(res.id || '')
    } catch {
      fail('inbox_unreachable')
    } finally {
      setBusy(false)
    }
  }

  const onShare = async (adminId: string) => {
    if (!jobId || !commit) return fail('roster_commit_required')
    if (adminId.toLowerCase().includes('keypackage')) return fail('keypackage_rejected')
    setBusy(true)
    try {
      const res = await submitShare(jobId, {
        admin_id: adminId,
        blob: `S:0:${adminId}`,
        roster_commit: commit,
      })
      if (!res.ok) return fail(res.error)
      setJob(res)
      const g = await getJob(jobId)
      if (g.ok) setJob(g)
      setNote(res.status || g.status || '')
    } catch {
      fail('inbox_unreachable')
    } finally {
      setBusy(false)
    }
  }

  const onBroadcast = async (e: FormEvent) => {
    e.preventDefault()
    const bad = requireNodeTxid(txid)
    if (bad) return fail(bad)
    if (!jobId) return fail('unknown_job')
    setBusy(true)
    try {
      const res = await broadcastJob(jobId, txid.trim())
      if (!res.ok) return fail(res.error)
      setJob(res)
      setNote(res.txid || '')
    } catch {
      fail('inbox_unreachable')
    } finally {
      setBusy(false)
    }
  }

  const kicker =
    gate !== 'ok' ? 'Admin' : tab === 'phones' ? 'Phones' : tab === 'participants' ? 'Participants' : 'Holders'

  return (
    <Frame title="Admin · The event" shape="tetra" core={[0.5, 0.3]}>
      <Halo kicker={kicker} title="Admin" />

      {gate === 'loading' ? (
        <div className="admin-lock" data-gate="loading">
          <span className="admin-badge">Checking</span>
        </div>
      ) : gate === 'signed_out' ? (
        <div className="admin-lock" data-gate="signed_out">
          <span className="admin-badge">Locked</span>
          <button className="pix-btn" type="button" onClick={() => openSignIn()}>
            Sign in
          </button>
        </div>
      ) : gate === 'forbidden' ? (
        <div className="admin-lock" data-gate="forbidden">
          <span className="admin-badge bad">Not authorized</span>
          {signInComplete(session) ? (
            <button className="pix-btn ghost" type="button" onClick={() => signOut()}>
              Sign out
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="admin-badges" aria-label="Session">
            <span className="admin-badge ok">{session?.role || live?.role || 'staff'}</span>
          </div>
          <div className="inline-form payroll-tabs" role="tablist" aria-label="Admin sections">
            <button
              className={tab === 'holders' ? 'pix-btn' : 'pix-btn ghost'}
              type="button"
              role="tab"
              aria-selected={tab === 'holders'}
              onClick={() => setTab('holders')}
            >
              Holders
            </button>
            <button
              className={tab === 'participants' ? 'pix-btn' : 'pix-btn ghost'}
              type="button"
              role="tab"
              aria-selected={tab === 'participants'}
              onClick={() => setTab('participants')}
            >
              Participants
            </button>
            <button
              className={tab === 'phones' ? 'pix-btn' : 'pix-btn ghost'}
              type="button"
              role="tab"
              aria-selected={tab === 'phones'}
              onClick={() => setTab('phones')}
            >
              Phones
            </button>
          </div>

          {tab === 'phones' ? (
            <div className="admin-phones">
              <UsherBlePanel />
            </div>
          ) : tab === 'participants' ? (
            <ParticipantsPanel />
          ) : (
            <div className="admin-stack">
              <Movement n={1} title="Group key">
                <AdminGroupKey />
              </Movement>
              <Movement n={2} title="Door pay">
                <DoorCashAppQr />
              </Movement>
              <Movement title="Usher chat" align="left">
                <UsherChat role={session?.role && isStaffRole(session.role) ? 'admin' : session?.role || null} />
              </Movement>
              <Movement n={3} title="Roster" align="left">
                <RosterPanel
                  onRoster={(next) => {
                    setRoster(next)
                    setCommit('')
                  }}
                />
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void hashRoster()
                  }}
                >
                  <button className="pix-btn" type="submit" disabled={!roster}>
                    Hash holders
                  </button>
                </form>
                {commit ? <p className="mono fine">{commit}</p> : null}
              </Movement>
              <Movement n={4} title="Ushers" align="left">
                <UsherPanel holders={roster?.seats || []} threshold={roster?.t || 0} />
              </Movement>
              <Movement n={5} title="Rotate" align="left">
                {rotateContract ? (
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const body = rotateExecuteBody({
                        newVkCommit: commit || roster?.groupVk || '',
                        nextSeats: roster?.seats,
                        nextT: roster?.t,
                        nextN: roster?.n,
                      })
                      void submitRotateToLab({
                        contract: rotateContract,
                        newVkCommit: body.rotate_frost_pubkey.new_vk_commit,
                        nextSeats: roster?.seats,
                        nextT: roster?.t,
                        nextN: roster?.n,
                      }).then((r) => {
                        if (!r.ok) fail(r.error)
                        else setNote(r.txhash || '')
                      })
                    }}
                  >
                    <button className="pix-btn ghost" type="submit">
                      Rotate
                    </button>
                  </form>
                ) : (
                  <div className="admin-empty" data-rotate="offline">
                    <span className="admin-badge">No contract</span>
                  </div>
                )}
              </Movement>
              <Movement n={6} title="Inbox" align="left">
                {inboxLive == null ? (
                  <div className="admin-empty" data-inbox="checking">
                    <span className="admin-badge">Checking</span>
                  </div>
                ) : inboxLive ? (
                  <>
                    <form className="inline-form" onSubmit={onCreateJob}>
                      <button className="pix-btn" type="submit" disabled={busy || !roster || !commit}>
                        New job
                      </button>
                      <button className="pix-btn ghost" type="button" disabled={busy || !jobId} onClick={() => void onShare('desk')}>
                        Share desk
                      </button>
                      <button className="pix-btn ghost" type="button" disabled={busy || !jobId} onClick={() => void onShare('steward')}>
                        Share steward
                      </button>
                    </form>
                    <form className="inline-form" onSubmit={onBroadcast}>
                      <input
                        className="field"
                        value={txid}
                        onChange={(e) => setTxid(e.target.value)}
                        aria-label="txid"
                        placeholder="txid"
                        spellCheck={false}
                      />
                      <button className="pix-btn ghost" type="submit" disabled={busy || !jobId}>
                        Broadcast
                      </button>
                    </form>
                    {job ? (
                      <div className="admin-badges">
                        <span className="admin-badge">{job.status || 'job'}</span>
                        <span className="admin-badge">{job.shares ?? 0}</span>
                        {job.id || jobId ? <span className="mono fine">{job.id || jobId}</span> : null}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="admin-empty" data-inbox="offline">
                    <span className="admin-badge">Offline</span>
                  </div>
                )}
                {note ? <p className="mono fine">{note}</p> : null}
                {error ? <p className="msg bad">{error}</p> : null}
              </Movement>
            </div>
          )}
        </>
      )}
    </Frame>
  )
}

export default Admin
