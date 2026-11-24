import { useEffect, useState } from 'react'

import { useAuth } from '../src/auth/AuthContext'
import { signInComplete } from '../src/auth/types'
import { CheckoutPanel, SHIELDED_FACTS } from '../src/event/CheckoutPanel'
import { EventGate } from '../src/event/Status'
import { RailId, RAIL_LABEL, TicketTier, discountPct, priceCents, eventOrigin } from '../src/event/api'
import { useEvent } from '../src/event/useEvent'
import { eventNameOf } from '../src/event/title'
import { docsHref, DOCS } from '../src/docs/links'
import { splashOn } from '../src/pay/invoice'
import { Frame } from '../src/ui/Frame'
import { InfoButton, InfoFacts } from '../src/ui/InfoPane'
import { Halo, Ledger, Movement } from '../src/ui/primitives'
import { CATALOG_RAILS, PriceDonut } from '../src/ui/PriceDonut'

const usd = (c: number) => `$${(c / 100).toFixed(2)}`

type PayChoice = RailId | 'door'

const railNote = (tier: TicketTier, id: RailId) => {
  const price = usd(priceCents(tier, id))
  const off = discountPct(tier, id)
  const cut = off ? `${off}% off list` : 'list'
  const lab = splashOn()
  if (id === 'zec')
    return lab
      ? `${price} · ${cut} · lab / testnet ZIP-321 for Zafu · do not send real funds`
      : `${price} · ${cut} · checkout opens soon · testnet/regtest`
  if (id === 'penumbra')
    return lab
      ? `${price} · ${cut} · lab Penumbra memo for Zafu · do not send real funds`
      : `${price} · ${cut} · coming, no SEZS watcher this round`
  return `${price} · ${cut}`
}

const maxQtyOf = (tier: TicketTier) => {
  const left = Math.max(0, (tier.supply || 0) - (tier.sold || 0))
  return left > 0 ? left : 8
}

type Topic = 'pay' | null

const Tickets = () => {
  const ev = useEvent()
  const { session, error, openSignIn } = useAuth()
  const [choice, setChoice] = useState<PayChoice | null>(null)
  const [qty, setQty] = useState(1)
  const [checkout, setCheckout] = useState(false)
  const [topic, setTopic] = useState<Topic>(null)
  const name = eventNameOf(ev.data?.event.name)
  const eventId = ev.data?.event.id
  const doorCents = ev.data?.doorCents ?? ev.data?.tiers[0]?.listCents
  const rail = choice === 'door' ? null : choice

  useEffect(() => {
    if (!checkout) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (topic) setTopic(null)
        else setCheckout(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [checkout, topic])

  return (
    <Frame title={`Tickets · ${name}`} shape="ring" core={[0.5, 0.2]} intensity={0.62}>
      <EventGate ev={ev}>
        {(data) => {
          const tier = data.tiers[0]
          if (!tier) return <p className="honest">No ticket tiers are on the event record yet.</p>
          const rails = CATALOG_RAILS.filter((id) => tier.rails.includes(id))
          const door = doorCents ?? tier.listCents
          const maxQty = maxQtyOf(tier)
          const clamp = (n: number) => Math.max(1, Math.min(maxQty, n))
          const setCount = (n: number) => {
            setQty(clamp(n))
            setCheckout(false)
          }
          const pick = (next: PayChoice) => {
            setChoice(next)
            setCheckout(false)
          }

          if (checkout && choice) {
            return (
              <section className="checkout-focus" data-checkout-modal="open">
                <Halo compact title="Checkout" />
                <div className="wallet-modal checkout-modal checkout-focus-card" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
                  <div className="wallet-modal-bar">
                    <h2 id="checkout-title">Checkout</h2>
                    <button type="button" className="pix-link" onClick={() => setCheckout(false)}>
                      close
                    </button>
                  </div>
                  <dl className="wallet-facts checkout-summary">
                    <div className="wallet-fact">
                      <dt>SKU</dt>
                      <dd>{tier.label || tier.id}</dd>
                    </div>
                    <div className="wallet-fact">
                      <dt>Tickets</dt>
                      <dd>{qty}{qty > 1 ? ' · one payment each' : ''}</dd>
                    </div>
                    <div className="wallet-fact">
                      <dt>Price</dt>
                      <dd>{choice === 'door' ? usd(door) : usd(priceCents(tier, rail!))} each</dd>
                    </div>
                    <div className="wallet-fact">
                      <dt>Method</dt>
                      <dd>{choice === 'door' ? 'Cash at the door' : RAIL_LABEL[rail!]}</dd>
                    </div>
                  </dl>
                  {choice === 'door' ? (
                    <p className="honest ok">Pay in cash at the door. No invoice is issued on this page.</p>
                  ) : (
                    <>
                      {!signInComplete(session) ? (
                        <p className="halo-act">
                          <button type="button" className="pix-link" onClick={() => openSignIn()}>
                            Sign in
                          </button>
                        </p>
                      ) : null}
                      <div className="wallet-pane-head info-head">
                        <h3 className="wallet-pane-title">Payment</h3>
                        <InfoButton
                          on={topic === 'pay'}
                          onClick={() => setTopic(topic === 'pay' ? null : 'pay')}
                          label={topic === 'pay' ? 'Close payment info' : 'Payment info'}
                        />
                      </div>
                      {topic === 'pay' ? (
                        <InfoFacts facts={SHIELDED_FACTS(rail!, usd(priceCents(tier, rail!)))} />
                      ) : (
                        <CheckoutPanel rail={rail!} tier={tier} eventId={eventId} eventName={name} domain={eventOrigin(ev.data?.event)} qty={qty} />
                      )}
                    </>
                  )}
                  {error ? <p className="msg bad">{error}</p> : null}
                  {session?.alias ? <p className="muted">Signed in as {session.alias}.</p> : null}
                </div>
              </section>
            )
          }

          return (
            <>
              <Halo compact title="Tickets" sub="Dance like no one is watching, by paying with money that can’t be." />

              <Movement n={1} title="Choose a payment method">
                <div className="ticket-stack">
                  <PriceDonut tier={tier} selected={rail} quiet />
                  <div className="rail-pick" role="radiogroup" aria-label="Payment method">
                    {rails.map((id) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={choice === id}
                        className={'rail-pick-btn' + (choice === id ? ' is-on' : '')}
                        onClick={() => pick(id)}
                      >
                        <strong>{id === 'zec' ? 'ZEC' : 'Penumbra'}</strong>
                        <span>{usd(priceCents(tier, id))}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={choice === 'door'}
                      className={'rail-pick-btn' + (choice === 'door' ? ' is-on' : '')}
                      onClick={() => pick('door')}
                    >
                      <strong>Cash at the door</strong>
                      <span>{usd(door)}</span>
                    </button>
                  </div>
                </div>
                {choice ? (
                  <div className="ticket-details">
                    <div className="qty-block">
                      <label className="qty-label" htmlFor="ticket-qty">Number of tickets</label>
                      <input
                        id="ticket-qty"
                        className="qty-input"
                        type="number"
                        min={1}
                        max={maxQty}
                        value={qty}
                        onChange={(e) => setCount(Number(e.target.value) || 1)}
                      />
                      <div className="qty-stepper">
                        <button
                          type="button"
                          className="qty-step"
                          aria-label="Decrease tickets"
                          disabled={qty <= 1}
                          onClick={() => setCount(qty - 1)}
                        >
                          −
                        </button>
                        <button
                          type="button"
                          className="qty-step"
                          aria-label="Increase tickets"
                          disabled={qty >= maxQty}
                          onClick={() => setCount(qty + 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <Ledger
                      rows={
                        choice === 'door'
                          ? [
                              { k: 'Cash at the door', v: usd(door) },
                              { k: 'Tickets', v: String(qty), tone: 'dim' },
                            ]
                          : [
                              { k: RAIL_LABEL[rail!], v: railNote(tier, rail!) },
                              { k: 'Tickets', v: String(qty), tone: 'dim' },
                            ]
                      }
                    />
                    <p className="halo-act ticket-go">
                      <button type="button" className="pix-btn" onClick={() => { setTopic(null); setCheckout(true) }}>
                        Continue to checkout
                      </button>
                    </p>
                    <p className="mv-foot ticket-docs">
                      <a className="pix-link" href={docsHref(DOCS.tickets)} target="_blank" rel="noopener noreferrer">
                        Details about tickets
                      </a>
                    </p>
                  </div>
                ) : null}
              </Movement>
            </>
          )
        }}
      </EventGate>
    </Frame>
  )
}

/* dest on screen ≠ paid · browser paid flag ≠ paid */
export default Tickets
