import dynamic from 'next/dynamic'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { ReactNode, useEffect } from 'react'

import { WalletControl } from '../auth/WalletControl'
import { SignInModal } from '../auth/SignInModal'
import { ArtistInfoModal, ArtistInfoProvider } from '../event/ArtistInfo'
import { useEvent } from '../event/useEvent'
import { eventNameOf } from '../event/title'
import { formatSpan, venueLine } from '../event/format'
import { DOCS, docsHref } from '../docs/links'
import { withBasePath } from './basePath'
import { EventPicker } from '../event/EventPicker'
import { NAV, OUTER, pathOn } from './nav'
import { NavMenu } from './NavMenu'
import type { Shape } from './shapes'

const Field = dynamic(() => import('./Field'), { ssr: false })

/**
 * Scroll depth → --depth on <html> (0 at top, 1 one-and-a-half screens down).
 * CSS uses it to blur and dim the field and raise a veil behind the text.
 * Smoothed with a short ease; with reduced motion it follows scroll directly.
 */
const useScrollDepth = (always?: boolean) => {
  useEffect(() => {
    const root = document.documentElement
    if (always) {
      root.setAttribute('data-blur', 'always')
      root.style.setProperty('--depth', '1')
      return () => {
        root.removeAttribute('data-blur')
        root.style.removeProperty('--depth')
      }
    }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let target = 0
    let cur = 0
    let raf = 0
    const read = () => {
      const h = window.innerHeight || 1
      target = Math.min(1, Math.max(0, (window.scrollY - h * 0.12) / (h * 1.4)))
    }
    const tick = () => {
      cur += (target - cur) * 0.18
      if (Math.abs(target - cur) < 0.002) cur = target
      root.style.setProperty('--depth', cur.toFixed(3))
      raf = cur === target ? 0 : requestAnimationFrame(tick)
    }
    const onScroll = () => {
      read()
      if (still) {
        cur = target
        root.style.setProperty('--depth', cur.toFixed(3))
      } else if (!raf) raf = requestAnimationFrame(tick)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      root.style.removeProperty('--depth')
    }
  }, [always])
}

/** Page frame. Replaces the old Shell. `shape`/`core` steer the field. */

const RailMark = ({ name }: { name: string }) => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i ? <span>·</span> : null}
          {part.toUpperCase()}
        </span>
      ))}
    </>
  )
}

export const Frame = ({
  title,
  shape,
  core,
  intensity,
  blur,
  children,
}: {
  title: string
  shape?: Shape
  core?: [number, number]
  /** 0–1 field brightness (lower where the hero sits on the core). */
  intensity?: number
  /** Blur the field immediately. Used on pages with no real scroll, like the artist desk. */
  blur?: 'always'
  children: ReactNode
}) => {
  const { pathname, query } = useRouter()
  const contractParam = typeof query.contract === 'string' ? query.contract : ''
  const withContract = (href: string) => (contractParam ? `${href}?contract=${encodeURIComponent(contractParam)}` : href)
  const ev = useEvent()
  const when = ev.data ? formatSpan(ev.data.event) : ''
  const foot = [eventNameOf(ev.data?.event.name), when || null, 'one room, one light'].filter(Boolean).join(' · ')
  const desc = ev.data
    ? `${ev.data.event.name}. ${when}. ${venueLine(ev.data.venue)}`
    : 'The event. The date and location come with the event record.'
  useScrollDepth(blur === 'always')
  return (
    <ArtistInfoProvider>
      <Head>
        <title>{title}</title>
        <meta name="description" content={desc} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href={withBasePath("/favicon.svg")} type="image/svg+xml" />
        <link rel="icon" href={withBasePath("/favicon-32.png")} type="image/png" sizes="32x32" />
        <link rel="apple-touch-icon" href={withBasePath("/apple-touch-icon.png")} />
      </Head>
      <Field shape={shape} core={core} intensity={intensity} />
      <div className="veil" aria-hidden="true" />
      <header className="rail">
        <Link href={withContract("/")} className="rail-mark" aria-label={`${eventNameOf(ev.data?.event.name)}, home`}>
          <span className="rail-mark-full" aria-hidden="true">
            <RailMark name={eventNameOf(ev.data?.event.name)} />
          </span>
          <span className="rail-mark-short" aria-hidden="true">SEZS</span>
        </Link>
        <nav className="rail-nav" aria-label="Night">
          {NAV.map((n, i) => (
            <Link key={n.href} href={withContract(n.href)} className={pathOn(pathname, n.href) ? 'is-on' : ''} aria-current={pathOn(pathname, n.href) ? 'page' : undefined}>
              <i>{String(i + 1).padStart(2, '0')}</i>
              {n.label}
            </Link>
          ))}
        </nav>
        <EventPicker />
        <WalletControl />
      </header>
      <main className="stage">{children}</main>
      <footer className="coda">
        <svg className="coda-arc" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 39 Q200 -10 400 39" />
        </svg>
        <nav aria-label="Crew and more">
          {OUTER.map((o) => (
            <Link key={o.href} href={withContract(o.href)}>
              {o.label}
            </Link>
          ))}
          <a href={docsHref(DOCS.gallery)} target="_blank" rel="noopener noreferrer">
            Docs
          </a>
        </nav>
        <p>{foot}</p>
      </footer>
      <NavMenu pathname={pathname} withContract={withContract} />
      <SignInModal />
      <ArtistInfoModal />
    </ArtistInfoProvider>
  )
}

/** Back-compat name for secondary pages. */
export const Shell = Frame
