export type GalleryWork = {
  id: string
  artistId: string
  artist: string
  title: string
  priceZec: number
  img?: string
  alt?: string
  about?: string
}

/** Listed works. Empty until artists list real pieces. */
export const GALLERY: GalleryWork[] = []

export const FAQ = {
  attendees: [
    {
      q: 'How do I get in?',
      a: 'Buy a ticket before you arrive. Sign in first. Checkout opens soon — a URI is not issued today. Guests unlock a passkey at the door. Only an usher still on the list can consume. Unpaid tickets, a second consume, and a removed usher are refused. A paid flag on the phone is not the door. The address comes with a paid ticket — not before.',
    },
    {
      q: 'How do I sign in?',
      a: 'Zafu, Keplr, or this browser. The browser path is an ephemeral key together with a passkey (allOf). A passkey alone is not sign-in, and sign-in is not paid.',
    },
    {
      q: 'How do I pay?',
      a: 'Buy before you arrive. Pick a payment method first; only that rail’s details are shown. Catalog order is shielded ZEC, then ETH, then Base, then shielded Penumbra. Checkout opens soon — no rail takes payment from tickets today. Shielded ZEC and shielded Penumbra are listed at half of list price when checkout is live. ETH and Base stay at list.',
    },
    {
      q: 'Can I pay with Cash App?',
      a: 'Not on tickets. Cash App is door and Admin only. QR not loaded — the app does not ship the image. There is no claim protocol on this site.',
    },
    {
      q: 'How do I buy a piece from the gallery?',
      a: 'The gallery is a wall of listed works when artists have pieces. Buy is off. There is no escrow contract, 72-hour release, or receipt token on this site today. The 11.1% + 11.1% + 77.8% split is written on the gallery page; it is not paid out. A disabled button is not a sale.',
    },
  ],
  artists: [
    {
      q: 'How do I list work?',
      a: 'Listing is not open. There is no invite flow and no on-chain authorization on this site. Do not upload a viewing key. Admin has not opened artist registration.',
    },
    {
      q: 'How does a sale settle?',
      a: 'Sale settlement is not live. No funds are held, no 72-hour timeout runs, and no receipt token is minted. The 11.1% + 11.1% + 77.8% split is copy on the gallery page.',
    },
    {
      q: 'When do I get paid for the set?',
      a: 'Crew FROST 20/80 is for the set after confirmed ticket inflow, to a transparent t-addr. Desk flags are not a send. No KeyPackages in the browser.',
    },
  ],
  sponsors: [
    {
      q: 'How do I get on the bill?',
      a: 'Book a 20-minute discovery call on the public calendar. That board is not the private reservations list, and a booking is not a ticket.',
    },
    {
      q: 'What’s already committed?',
      a: 'The sponsors page lists who is on the record for this event. That list comes from the event contract (or the local event record until a contract is configured), not from this page.',
    },
    {
      q: 'Can we raffle something?',
      a: 'Yes — say so on the discovery call. Coordinators register prizes and entry counts on the event record. A verifiable randomness oracle picks the winning entry when a draw is requested and an oracle is available.',
    },
  ],
} as const
