import { RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { applyFont, FONT_THEMES, FontTheme, readFont } from './fonts'
import { useFocusTrap } from './focusTrap'
import { applyTone, readTone, TONE_THEMES, ToneTheme } from './tone'

export const TextAndDesign = ({
  open,
  onClose,
  restore,
}: {
  open: boolean
  onClose: () => void
  restore?: RefObject<HTMLElement | null>
}) => {
  const panelRef = useRef<HTMLDivElement>(null)
  const [font, setFont] = useState<FontTheme>('zakura')
  const [tone, setTone] = useState<ToneTheme>('night')

  useEffect(() => {
    if (!open) return
    setFont(readFont())
    setTone(readTone())
  }, [open])

  const close = useCallback(() => onClose(), [onClose])
  useFocusTrap(panelRef, open, close, restore)

  if (!open) return null

  const pickFont = (next: FontTheme) => {
    setFont(next)
    applyFont(next)
  }
  const pickTone = (next: ToneTheme) => {
    setTone(next)
    applyTone(next)
  }

  return (
    <div className="design-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div
        ref={panelRef}
        className="design-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-title"
      >
        <header className="design-head">
          <h2 id="design-title">Text and design</h2>
          <button type="button" className="design-close" onClick={close} aria-label="Close">
            Close
          </button>
        </header>
        <fieldset className="design-set">
          <legend>Look</legend>
          <div className="design-choices" role="radiogroup" aria-label="Look">
            {TONE_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={tone === t.id}
                className={tone === t.id ? 'is-on' : ''}
                onClick={() => pickTone(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="design-set">
          <legend>Type</legend>
          <div className="design-choices" role="radiogroup" aria-label="Type">
            {FONT_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={font === t.id}
                className={'design-font is-' + t.id + (font === t.id ? ' is-on' : '')}
                onClick={() => pickFont(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  )
}
