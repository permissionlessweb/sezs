/**
 * Door pointer for check-in. SoT is cw-ave GuestRoot, never ListMembers.
 * This module does not consume, does not write attendance, does not POST.
 */
import { CHAIN } from '../auth/chainConfig'

const LCD = (process.env.NEXT_PUBLIC_SEZS_LCD || process.env.NEXT_PUBLIC_SEZS_REST || CHAIN.rest || '').replace(/\/$/, '')
const CW_AVE = (process.env.NEXT_PUBLIC_SEZS_CW_AVE || '').trim()

export type DoorState = {
  cw_ave: string
  guest_root: string
  source: 'lcd' | 'empty'
  note: string
}

const EMPTY: DoorState = {
  cw_ave: '',
  guest_root: '',
  source: 'empty',
  note: 'No on-chain door contract on this build. Unlock is a passkey assertion only. Admission here is a holder-consent check against the lab paid set. It does not verify a Halo2 proof.',
}

const b64json = (o: unknown) => {
  const s = JSON.stringify(o)
  if (typeof btoa === 'function') return btoa(s)
  return Buffer.from(s).toString('base64')
}

export function doorEnv(): { lcd: string; cw_ave: string } {
  return { lcd: LCD, cw_ave: CW_AVE }
}

export async function loadDoor(): Promise<DoorState> {
  if (!LCD || !CW_AVE) return EMPTY
  try {
    const q = b64json({ guest_root: {} })
    const r = await fetch(`${LCD}/cosmwasm/wasm/v1/contract/${encodeURIComponent(CW_AVE)}/smart/${q}`, {
      credentials: 'omit',
    })
    if (!r.ok) {
      return {
        cw_ave: CW_AVE,
        guest_root: '',
        source: 'empty',
        note: `Door query failed (HTTP ${r.status}). This page still does not consume.`,
      }
    }
    const j = await r.json()
    const data = j.data || j
    const root = data.guest_root
    const hex =
      typeof root === 'string'
        ? root
        : root && typeof root === 'object' && typeof root.toString === 'function'
          ? String(root)
          : ''
    return {
      cw_ave: CW_AVE,
      guest_root: hex,
      source: hex ? 'lcd' : 'empty',
      note: hex
        ? 'guest_root is on cw-ave. This page does not consume it.'
        : 'cw-ave has no guest_root yet. Paid leaves have not been posted.',
    }
  } catch {
    return {
      cw_ave: CW_AVE,
      guest_root: '',
      source: 'empty',
      note: 'Could not reach the LCD. Unlock still works. Consume does not run here.',
    }
  }
}

/** Hard rule: never query cw420 ListMembers as who’s coming. */
export const FORBIDDEN_DOOR_QUERIES = ['list_members', 'ListMembers', 'attendance'] as const
