import { useEffect, useRef } from 'react'

import { nextIngestedFrame } from './api'
import { decodeFrame } from './messages.mjs'

/**
 * Poll the loopback ingest queue and hand each signed frame's sezs3
 * payload to the door. The caller still verifies and authorizes.
 */
export const useBleFrames = (enabled: boolean, onFrame: (raw: string, envelope: { frameText: string; frameSig: string; grantHash?: string }) => void) => {
  const cb = useRef(onFrame)
  cb.current = onFrame
  useEffect(() => {
    if (!enabled) return
    let live = true
    const tick = async () => {
      try {
        const r = await nextIngestedFrame()
        const f = r.frame
        if (live && f?.frameText && f?.frameSig) {
          const decoded = decodeFrame(f.frameText)
          cb.current(decoded.payload, { frameText: f.frameText, frameSig: f.frameSig, grantHash: f.grantHash || decoded.grantHash })
        }
      } catch {
        /* helper or splash may be down */
      }
      if (live) window.setTimeout(tick, 800)
    }
    const t = window.setTimeout(tick, 400)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [enabled])
}
