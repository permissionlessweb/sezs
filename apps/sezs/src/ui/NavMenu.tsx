import Link from 'next/link'
import { useCallback, useRef, useState } from 'react'

import { DOCS, docsHref } from '../docs/links'
import { useFocusTrap } from './focusTrap'
import { NAV, OUTER, pathOn } from './nav'
import { TextAndDesign } from './TextAndDesign'

export const NavMenu = ({
  pathname,
  withContract,
}: {
  pathname: string
  withContract: (href: string) => string
}) => {
  const [open, setOpen] = useState(false)
  const [design, setDesign] = useState(false)
  const drawerRef = useRef<HTMLElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const designBtnRef = useRef<HTMLButtonElement>(null)

  const closeMenu = useCallback(() => {
    setOpen(false)
    fabRef.current?.focus()
  }, [])
  const closeDesign = useCallback(() => setDesign(false), [])

  useFocusTrap(drawerRef, open && !design, closeMenu)

  const openDesign = () => {
    setOpen(false)
    setDesign(true)
  }

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className={'nav-fab' + (open || design ? ' is-open' : '')}
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="nav-drawer"
        onClick={() => {
          if (design) {
            setDesign(false)
            return
          }
          setOpen((v) => !v)
        }}
      >
        <span className="nav-fab-bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="nav-scrim"
            tabIndex={-1}
            aria-label="Close menu"
            onClick={closeMenu}
          />
          <aside
            id="nav-drawer"
            ref={drawerRef}
            className={'nav-drawer' + (design ? ' is-behind' : '')}
            role="dialog"
            aria-modal={!design}
            aria-hidden={design}
            aria-label="Menu"
          >
            <nav className="nav-drawer-prime" aria-label="Night">
              {NAV.map((n, i) => (
                <Link
                  key={n.href}
                  href={withContract(n.href)}
                  className={pathOn(pathname, n.href) ? 'is-on' : ''}
                  aria-current={pathOn(pathname, n.href) ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                >
                  <i>{String(i + 1).padStart(2, '0')}</i>
                  {n.label}
                </Link>
              ))}
            </nav>
            <nav className="nav-drawer-more" aria-label="Crew and more">
              {OUTER.map((o) => (
                <Link key={o.href} href={withContract(o.href)} onClick={() => setOpen(false)}>
                  {o.label}
                </Link>
              ))}
              <a href={docsHref(DOCS.gallery)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
                Docs
              </a>
            </nav>
            <button
              ref={designBtnRef}
              type="button"
              className="nav-drawer-design"
              onClick={openDesign}
            >
              Text and design
            </button>
          </aside>
        </>
      ) : null}
      <TextAndDesign open={design} onClose={closeDesign} restore={fabRef} />
    </>
  )
}
