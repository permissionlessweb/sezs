import { useRouter } from 'next/router'
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { shortAddr } from '../auth/chainConfig'
import { eventContracts, readBoot, rememberSelectedContract } from './boot'
import { useEventSummaries } from './useEventSummaries'

export const EventPicker = () => {
  const router = useRouter()
  const contracts = useMemo(() => eventContracts(), [])
  const [active, setActive] = useState('')
  const [open, setOpen] = useState(false)
  const [focusIx, setFocusIx] = useState(0)
  const [wantOthers, setWantOthers] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const warmOthers = () => setWantOthers(true)

  useEffect(() => {
    setActive(readBoot().contract || contracts[0] || '')
  }, [contracts, router.asPath])
  useEffect(() => {
    if (open) warmOthers()
  }, [open])
  const items = useEventSummaries(contracts.length > 1 ? contracts : [], { others: wantOthers })

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (!open) return
    const ix = Math.max(0, contracts.indexOf(active))
    setFocusIx(ix)
    listRef.current?.focus()
  }, [open, contracts, active])

  if (contracts.length <= 1) return null

  const labelFor = (addr: string) => {
    const found = items.find((i) => i.contract === addr)
    if (found?.name) return found.name
    return shortAddr(addr)
  }

  const choose = (next: string) => {
    rememberSelectedContract(next)
    setActive(next)
    setOpen(false)
    btnRef.current?.focus()
    const query = { ...router.query, contract: next }
    void router.push({ pathname: router.pathname, query })
  }

  const move = (delta: number) => {
    setFocusIx((cur) => {
      const n = contracts.length
      return (cur + delta + n) % n
    })
  }

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setFocusIx(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setFocusIx(contracts.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const next = contracts[focusIx]
      if (next) choose(next)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      btnRef.current?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const onBtnKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const ix = Math.max(0, contracts.indexOf(active))
      setFocusIx(e.key === 'ArrowUp' ? contracts.length - 1 : ix)
      setOpen(true)
    }
  }

  const listId = 'event-picker-list'
  const activeId = open ? `event-opt-${focusIx}` : undefined

  return (
    <div
      className={'event-switch' + (open ? ' is-open' : '')}
      ref={rootRef}
      onMouseEnter={warmOthers}
      onFocusCapture={warmOthers}
    >
      <span className="event-switch-glyph" aria-hidden="true">◈</span>
      <button
        ref={btnRef}
        type="button"
        className="event-switch-btn"
        aria-label="Event"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onBtnKey}
      >
        <span className="event-switch-value">{labelFor(active)}</span>
      </button>
      {open ? (
        <ul
          id={listId}
          ref={listRef}
          className="event-switch-list"
          role="listbox"
          aria-label="Event"
          aria-activedescendant={activeId}
          tabIndex={-1}
          onKeyDown={onListKey}
        >
          {contracts.map((c, idx) => (
            <li
              key={c}
              id={`event-opt-${idx}`}
              role="option"
              aria-selected={c === active}
              className={(c === active ? 'is-on' : '') + (idx === focusIx ? ' is-focus' : '')}
              onMouseEnter={() => setFocusIx(idx)}
              onClick={() => choose(c)}
            >
              {labelFor(c)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
