/**
 * Admin / artist draft editor. Page-local only. Does not upload, sign, or list.
 * Synopsis and socials render as text (escaped). No innerHTML.
 */
import { FormEvent, useMemo, useState } from 'react'

import { CollectionsPrep, type Adapter, type ChainId, type Kind } from './CollectionsPrep'
import {
  ArtistShowcase,
  LOGIN_METHODS,
  SOCIAL_KINDS,
  SYNOPSIS_MAX,
  emptyShowcase,
  escapeHtml,
  validateShowcase,
  type FieldError,
  type LoginMethod,
  type ShowcaseSocial,
} from './showcase'

const errAt = (errs: FieldError[], path: string) => errs.find((e) => e.path === path)?.message

export function ShowcaseEditor({
  value,
  onChange,
}: {
  value: ArtistShowcase
  onChange: (next: ArtistShowcase) => void
}) {
  const [draft, setDraft] = useState<ArtistShowcase>({
    ...emptyShowcase(),
    ...value,
    payout: value.payout || {},
  })
  const errs = useMemo(() => validateShowcase(draft), [draft])
  const set = (p: Partial<ArtistShowcase>) => {
    const merged: ArtistShowcase = {
      ...draft,
      ...p,
      payout: p.payout ? { ...draft.payout, ...p.payout } : draft.payout,
    }
    setDraft(merged)
    onChange(merged)
  }

  const addSocial = (e: FormEvent) => {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const kind = (form.elements.namedItem('kind') as HTMLSelectElement)
      .value as ShowcaseSocial['kind']
    const href = (form.elements.namedItem('href') as HTMLInputElement).value.trim()
    set({ socials: [...draft.socials, { kind, href }] })
    form.reset()
  }

  const addWork = (e: FormEvent) => {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const title = (form.elements.namedItem('title') as HTMLInputElement).value.trim()
    const priceZec = Number((form.elements.namedItem('price') as HTMLInputElement).value)
    set({
      works: [
        ...draft.works,
        {
          id: `draft-${draft.works.length + 1}`,
          title,
          priceZec,
          listed: false,
        },
      ],
    })
    form.reset()
  }

  return (
    <div className="gx-panel">
      <h2>Artist showcase</h2>
      <p className="gx-note">
        Synopsis, links, collections, and payout addresses for the public
        gallery. Drafts stay on this page. Nothing is listed until escrow exists.
      </p>
      <label>
        Name{' '}
        <input
          className="field"
          value={draft.displayName}
          onChange={(e) => set({ displayName: e.target.value })}
          maxLength={80}
        />
      </label>
      {errAt(errs, 'displayName') ? (
        <p className="gx-note" role="alert">
          {errAt(errs, 'displayName')}
        </p>
      ) : null}
      <label>
        Synopsis{' '}
        <textarea
          className="field"
          value={draft.synopsis}
          onChange={(e) => set({ synopsis: e.target.value })}
          maxLength={SYNOPSIS_MAX}
          rows={4}
        />
      </label>
      {errAt(errs, 'synopsis') ? (
        <p className="gx-note" role="alert">
          {errAt(errs, 'synopsis')}
        </p>
      ) : null}

      <label>
        Sign-in method{' '}
        <select
          className="field"
          value={draft.loginMethod || ''}
          onChange={(e) =>
            set({
              loginMethod: (e.target.value || undefined) as LoginMethod | undefined,
            })
          }
        >
          <option value="">unset</option>
          {LOGIN_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <h3 style={{ marginTop: '1rem' }}>Socials</h3>
      <ul>
        {draft.socials.map((row, i) => (
          <li key={i} className="gx-note">
            {row.kind}: {row.href}{' '}
            <button
              className="btn ghost btn-sm"
              type="button"
              onClick={() => set({ socials: draft.socials.filter((_, j) => j !== i) })}
            >
              Remove
            </button>
            {errAt(errs, `socials.${i}.href`) ? (
              <span role="alert"> {errAt(errs, `socials.${i}.href`)}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <form onSubmit={addSocial} style={{ display: 'grid', gap: '.4rem' }}>
        <select className="field" name="kind">
          {SOCIAL_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <label htmlFor="showcase-href">https link</label>
        <input id="showcase-href" className="field" name="href" spellCheck={false} />
        <button className="btn btn-sm" type="submit">
          Add link
        </button>
      </form>

      <h3 style={{ marginTop: '1rem' }}>Works (drafts)</h3>
      <p className="gx-note">Kept unlisted. Listing waits on a live escrow.</p>
      <ul>
        {draft.works.map((row, i) => (
          <li key={row.id} className="gx-note">
            {row.title || '(untitled)'} · {row.priceZec} ZEC · draft{' '}
            <button
              className="btn ghost btn-sm"
              type="button"
              onClick={() => set({ works: draft.works.filter((_, j) => j !== i) })}
            >
              Remove
            </button>
            {errAt(errs, `works.${i}.title`) ? (
              <span role="alert"> {errAt(errs, `works.${i}.title`)}</span>
            ) : null}
            {errAt(errs, `works.${i}.priceZec`) ? (
              <span role="alert"> {errAt(errs, `works.${i}.priceZec`)}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <form onSubmit={addWork} style={{ display: 'grid', gap: '.4rem' }}>
        <label htmlFor="showcase-title">Title</label>
        <input id="showcase-title" className="field" name="title" maxLength={120} />
        <label htmlFor="showcase-price">Price in ZEC</label>
        <input
          id="showcase-price"
          className="field"
          name="price"
          type="number"
          min="0"
          step="0.0001"
        />
        <button className="btn btn-sm" type="submit">
          Add draft work
        </button>
      </form>

      <h3 style={{ marginTop: '1rem' }}>Payout (optional, off-chain)</h3>
      <p className="gx-note">
        Spec keeps payout addresses with the profile, not on-chain. Leave blank
        until escrow exists.
      </p>
      <label>
        Shielded ZEC{' '}
        <input
          className="field"
          value={draft.payout?.zec || ''}
          onChange={(e) => set({ payout: { ...draft.payout, zec: e.target.value } })}
          spellCheck={false}
        />
      </label>
      {errAt(errs, 'payout.zec') ? (
        <p className="gx-note" role="alert">
          {errAt(errs, 'payout.zec')}
        </p>
      ) : null}
      <label>
        Terp{' '}
        <input
          className="field"
          value={draft.payout?.terp || ''}
          onChange={(e) => set({ payout: { ...draft.payout, terp: e.target.value } })}
          spellCheck={false}
        />
      </label>
      {errAt(errs, 'payout.terp') ? (
        <p className="gx-note" role="alert">
          {errAt(errs, 'payout.terp')}
        </p>
      ) : null}
      <label>
        EVM{' '}
        <input
          className="field"
          value={draft.payout?.evm || ''}
          onChange={(e) => set({ payout: { ...draft.payout, evm: e.target.value } })}
          spellCheck={false}
        />
      </label>
      {errAt(errs, 'payout.evm') ? (
        <p className="gx-note" role="alert">
          {errAt(errs, 'payout.evm')}
        </p>
      ) : null}

      <h3 style={{ marginTop: '1rem' }}>Preview (escaped)</h3>
      <div className="gx-note" data-preview="showcase">
        <strong>{draft.displayName}</strong>
        <p>{draft.synopsis}</p>
        <p hidden>{escapeHtml(draft.synopsis)}</p>
      </div>

      <p className="gx-note" style={{ marginTop: '1rem' }}>
        Charity of the artist’s choice (11.1% of gross) is recorded at listing.
        The picker opens when shielded ZEC is live. No allowlist is published yet.
      </p>

      <CollectionsPrep
        seed={draft.collections}
        onChange={(collections) =>
          set({
            collections: collections.map((r) => ({
              chain: r.chain as ChainId,
              addr: r.addr,
              kind: r.kind as Kind,
              adapter: r.adapter as Adapter,
            })),
          })
        }
      />

      {errs.length ? (
        <p className="gx-note" role="status" style={{ marginTop: '1rem' }}>
          {errs.length} item{errs.length === 1 ? '' : 's'} still to fix before this
          can be listed.
        </p>
      ) : (
        <p className="gx-note" style={{ marginTop: '1rem' }}>
          Draft is well-formed. Listing still waits on the gallery escrow.
        </p>
      )}
    </div>
  )
}

export { emptyShowcase }
