const rawBase =
  typeof process !== 'undefined'
    ? (process.env.NEXT_PUBLIC_BASE_PATH || process.env.SEZS_BASE_PATH || '').trim().replace(/\/+$/, '')
    : ''

export const BASE_PATH = rawBase ? (rawBase.startsWith('/') ? rawBase : `/${rawBase}`) : ''

export function withBasePath(path: string): string {
  if (!path) return BASE_PATH || '/'
  if (/^(?:[a-z]+:|\/\/)/i.test(path)) return path
  const clean = path.startsWith('/') ? path : `/${path}`
  if (!BASE_PATH) return clean
  if (clean === BASE_PATH || clean.startsWith(`${BASE_PATH}/`)) return clean
  return `${BASE_PATH}${clean}`
}
