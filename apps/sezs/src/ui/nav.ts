export const NAV = [
  { href: '/', label: 'night' },
  { href: '/tickets', label: 'tickets' },
  { href: '/lineup', label: 'lineup' },
  { href: '/gallery', label: 'gallery' },
  { href: '/faq', label: 'faq' },
] as const

export const OUTER = [
  { href: '/keys', label: 'Keys' },
  { href: '/sponsors', label: 'Sponsors' },
  { href: '/check-in', label: 'Check-in' },
  { href: '/door', label: 'Door' },
  { href: '/desk', label: 'Artist desk' },
  { href: '/admin', label: 'Admin' },
  { href: '/register', label: 'Register' },
  { href: '/stream', label: 'Stream' },
] as const

export const pathOn = (path: string, href: string) =>
  href === '/' ? path === '/' : path === href || path.startsWith(href + '/')
