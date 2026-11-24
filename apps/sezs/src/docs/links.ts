/** Documentation origin. Lab default is the local docs server. */
export const docsOrigin = (): string => {
  const env = typeof process !== 'undefined' ? String(process.env.NEXT_PUBLIC_SEZS_DOCS || '').trim() : ''
  if (env) return env.replace(/\/$/, '')
  return 'http://127.0.0.1:3054'
}

export const docsHref = (path: string): string => {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${docsOrigin()}${p}`
}

export const DOCS = {
  wallets: '/guides/general/wallets/',
  tickets: '/guides/general/purchasing-a-ticket/',
  gallery: '/specs/gallery/',
} as const
