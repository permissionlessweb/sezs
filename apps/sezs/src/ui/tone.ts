/** Color tone. Default night. Persisted in localStorage 'sezs-tone'. */
export const TONE_THEMES = [
  { id: 'night', label: 'Night' },
  { id: 'day', label: 'Day' },
] as const
export type ToneTheme = (typeof TONE_THEMES)[number]['id']
export const TONE_KEY = 'sezs-tone'
export const DEFAULT_TONE: ToneTheme = 'night'

export const isTone = (v: string | null | undefined): v is ToneTheme =>
  v === 'night' || v === 'day'

export const applyTone = (tone: ToneTheme) => {
  document.documentElement.dataset.tone = tone
  try {
    localStorage.setItem(TONE_KEY, tone)
  } catch {
    /* private mode: tone still applies for this page */
  }
}

export const readTone = (): ToneTheme => {
  if (typeof document === 'undefined') return DEFAULT_TONE
  const cur = document.documentElement.dataset.tone
  return isTone(cur) ? cur : DEFAULT_TONE
}

/** Inline pre-paint script for _document (no flash). ?tone=day|night also sets it. */
export const TONE_BOOT = `try{var q=/[?&]tone=(day|night)/.exec(location.search),t=q?q[1]:localStorage.getItem('${TONE_KEY}');if(q)localStorage.setItem('${TONE_KEY}',q[1]);if(t!=='day'&&t!=='night')t='${DEFAULT_TONE}';document.documentElement.dataset.tone=t}catch(e){document.documentElement.dataset.tone='${DEFAULT_TONE}'}`
