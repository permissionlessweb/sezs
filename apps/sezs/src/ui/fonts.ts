/** Font themes. Default Zakura. Persisted in localStorage 'sezs-font'. */
export const FONT_THEMES = [
  { id: 'zakura', label: 'Zakura' },
  { id: 'outfit', label: 'Outfit' },
  { id: 'garamond', label: 'Garamond' },
  { id: 'fraunces', label: 'Fraunces' },
] as const
export type FontTheme = (typeof FONT_THEMES)[number]['id']
export const FONT_KEY = 'sezs-font'
export const DEFAULT_FONT: FontTheme = 'zakura'

export const isFont = (v: string | null | undefined): v is FontTheme =>
  FONT_THEMES.some((t) => t.id === v)

export const applyFont = (font: FontTheme) => {
  document.documentElement.dataset.font = font
  try {
    localStorage.setItem(FONT_KEY, font)
  } catch {
    /* private mode: theme still applies for this page */
  }
}

export const readFont = (): FontTheme => {
  if (typeof document === 'undefined') return DEFAULT_FONT
  const cur = document.documentElement.dataset.font
  return isFont(cur) ? cur : DEFAULT_FONT
}

/** Inline pre-paint script for _document (no flash). ?font=<id> also sets it (for screenshots/links). */
export const FONT_BOOT = `try{var q=/[?&]font=([a-z]+)/.exec(location.search),f=q?q[1]:localStorage.getItem('${FONT_KEY}');if(q)localStorage.setItem('${FONT_KEY}',q[1]);if(!/^(zakura|outfit|garamond|fraunces)$/.test(f||''))f='${DEFAULT_FONT}';document.documentElement.dataset.font=f}catch(e){document.documentElement.dataset.font='${DEFAULT_FONT}'}`
