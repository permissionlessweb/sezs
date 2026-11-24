/** Door pointer. Cache only. Never attendance, never a name list. */

const ADDR = /^terp1[0-9a-z]{20,80}$/

export type DoorView = {
  /** What the guest may read. No names. */
  text: string
  /** Contract address when the night published one. */
  cwAve: string | null
  /** True only when we would ask the chain. The page still must not consume. */
  lookup: boolean
}

export function doorView(input: {
  lcdSet: boolean
  calendarSet: boolean
  cwAve?: string | null
}): DoorView {
  if (!input.lcdSet || !input.calendarSet) {
    return {
      text: 'The door contract is not published on this page.',
      cwAve: null,
      lookup: false,
    }
  }
  const addr = (input.cwAve || '').trim()
  if (!addr) {
    return {
      text: 'This night has no door contract yet.',
      cwAve: null,
      lookup: true,
    }
  }
  if (!ADDR.test(addr)) {
    return {
      text: 'The door pointer on this night is not a Terp contract.',
      cwAve: null,
      lookup: true,
    }
  }
  return {
    text: 'Door contract is on this night. Check-in still does not mark you in.',
    cwAve: addr,
    lookup: true,
  }
}

/** Reject roster-shaped metadata. */
export function metadataLeaksRoster(json: string): boolean {
  return /cashtag|ListMembers|"alias"|31925/i.test(json)
}
