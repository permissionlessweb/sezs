import { RefObject, useEffect } from 'react'

const FOCUSABLE = 'a[href],button:not([disabled]),select,textarea,input,[tabindex]:not([tabindex="-1"])'

const targets = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && el.tabIndex !== -1,
  )

/**
 * Trap Tab inside `ref` while `active`. Escape calls `onClose`.
 * If `restore` is passed, focus returns to it (or to the previously focused node) on exit.
 */
export const useFocusTrap = (
  ref: RefObject<HTMLElement>,
  active: boolean,
  onClose: () => void,
  restore?: RefObject<HTMLElement | null>,
) => {
  useEffect(() => {
    if (!active) return
    const root = ref.current
    if (!root) return
    const prev = (document.activeElement as HTMLElement | null) ?? null
    const first = targets(root)[0]
    first?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const list = targets(root)
      if (!list.length) {
        e.preventDefault()
        return
      }
      const i = list.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && i <= 0) {
        e.preventDefault()
        list[list.length - 1].focus()
      } else if (!e.shiftKey && (i === list.length - 1 || i === -1)) {
        e.preventDefault()
        list[0].focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
      if (restore) (restore.current || prev)?.focus?.()
    }
  }, [active, onClose, ref, restore])
}
