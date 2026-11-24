/**
 * Splash board (DEV ONLY). Loopback status for the Rust backend processes
 * that replaced the Node splash mock: sezs-server (127.0.0.1:3058) and
 * sezs-outpost (127.0.0.1:3061). Production static export never mounts this page.
 */
import { useEffect, useState } from 'react'

import { Frame } from '../ui/Frame'
import { Halo, Movement } from '../ui/primitives'
import s from './Board.module.css'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

type Probe = { ok: boolean; detail: string }

const probe = async (url: string): Promise<Probe> => {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    const body = await r.json().catch(() => ({}))
    if (r.ok && (body as { ok?: boolean }).ok !== false) {
      return { ok: true, detail: `${r.status} ${(body as { service?: string }).service || 'ok'}` }
    }
    return { ok: false, detail: `${r.status}` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'unreachable' }
  }
}

export default function Board() {
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const allowed = LOOPBACK.has(host)
  const [server, setServer] = useState<Probe | null>(null)
  const [outpost, setOutpost] = useState<Probe | null>(null)

  useEffect(() => {
    if (!allowed) return
    probe('/sezs/session/health').then(setServer)
    probe('http://127.0.0.1:3061/health').then(setOutpost)
  }, [allowed])

  if (!allowed) {
    return (
      <Frame title="Splash · dev only" shape="cube" core={[0.5, 0.3]}>
        <Halo kicker="Dev only" title="Loopback only" sub="Open this board on 127.0.0.1:3051 or localhost:3051." />
      </Frame>
    )
  }

  return (
    <Frame title="Splash board · dev only" shape="icosa" core={[0.5, 0.26]} intensity={0.55}>
      <Halo
        kicker="Dev only"
        title="SEZS loopback"
        sub="sezs-server on :3058 (session, ticketing, payroll; email if SEZS_EMAIL_ENABLE=1) and sezs-outpost on :3061."
      />
      <Movement n={1} title="Processes" lede="Start them with just sezs-server and just sezs-outpost. Next dev rewrites /sezs to the one bind.">
        <p className={server?.ok ? s.pass : s.fail}>
          sezs-server /sezs/session/health: {server ? server.detail : '…'}
        </p>
        <p className={outpost?.ok ? s.pass : s.fail}>
          sezs-outpost /health: {outpost ? outpost.detail : '…'}
        </p>
      </Movement>
    </Frame>
  )
}
